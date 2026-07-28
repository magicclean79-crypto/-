import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import {
  applyLifecycleAction,
  assignSticky,
  experimentSignature,
  ExperimentLifecycleError,
  variantKey,
} from "@acos/core";
import type {
  Experiment,
  ExperimentAction,
  ExperimentStatus,
  LifecycleState,
  StickyAssignment,
} from "@acos/core";
import type {
  ExperimentAssignmentDto,
  ExperimentEventDto,
  ExperimentLifecycleDto,
} from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Experiment Lifecycle & Sticky Assignment 서비스. (TASK-1101, Sprint 11)
 *
 * 실험 **정의**(변형·가중치)는 환경변수가 원천이고(CTO 결정 1003-② 표기법
 * 확정), 이 서비스는 **운영 중 바뀌는 상태**만 다룬다:
 * - 상태: RUNNING(기본) / STOPPED / PROMOTED — 행이 없으면 RUNNING으로 본다
 *   (TASK-1003 동작 보존 — 실험을 켜려고 별도 조작이 필요하지 않다)
 * - 전이 이력: Rollback의 근거이자 감사 기록
 * - Sticky 배정: Project → 변형. 배정 자체는 **결정적 해시**로 정해지므로
 *   저장이 실패해도 결과가 흔들리지 않는다 (저장은 관측·감사용)
 */
@Injectable()
export class ExperimentLifecycleService {
  private readonly logger = new Logger(ExperimentLifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** feature의 현재 상태 (행이 없으면 기본 RUNNING) */
  async state(feature: string): Promise<LifecycleState> {
    const row = await this.prisma.experimentState.findUnique({
      where: { feature },
    });
    return {
      status: (row?.status as ExperimentStatus) ?? "RUNNING",
      promotedVariant: row?.promotedVariant ?? null,
    };
  }

  /**
   * Project 기반 Sticky 배정. 저장된 배정이 있으면 재사용하고,
   * 없으면 결정적 해시로 정해 저장한다.
   * **저장 실패는 호출을 실패시키지 않는다** (Execution 기록과 같은 원칙) —
   * 배정 값 자체는 해시로 정해지므로 저장 없이도 일관된다.
   */
  async assign(
    experiment: Experiment,
    projectId: string,
    availableProviders: string[],
  ): Promise<StickyAssignment | null> {
    let existing: { variantKey: string; signature: string } | null = null;
    try {
      existing = await this.prisma.experimentAssignment.findUnique({
        where: { feature_projectId: { feature: experiment.feature, projectId } },
        select: { variantKey: true, signature: true },
      });
    } catch (error) {
      this.logger.warn(`Sticky 배정 조회 실패 (해시로 진행): ${error}`);
    }

    const assigned = assignSticky({
      experiment,
      projectId,
      availableProviders,
      existing,
    });
    if (!assigned || assigned.reused) {
      return assigned;
    }

    try {
      const state = await this.ensureState(experiment.feature);
      await this.prisma.experimentAssignment.upsert({
        where: { feature_projectId: { feature: experiment.feature, projectId } },
        create: {
          stateId: state.id,
          feature: experiment.feature,
          projectId,
          variantKey: assigned.key,
          signature: assigned.signature,
        },
        update: { variantKey: assigned.key, signature: assigned.signature },
      });
    } catch (error) {
      // 저장 실패해도 같은 해시로 같은 결과가 나온다
      this.logger.warn(`Sticky 배정 저장 실패 (배정은 유효): ${error}`);
    }
    return assigned;
  }

  private async ensureState(feature: string) {
    return this.prisma.experimentState.upsert({
      where: { feature },
      create: { feature },
      update: {},
    });
  }

  /**
   * 상태 전이 (Start / Stop / Promote / Rollback).
   * Rollback은 **직전 전이의 이전 상태**로 되돌린다 (이력이 없으면 RUNNING).
   */
  async transition(input: {
    feature: string;
    action: ExperimentAction;
    variantKey?: string | null;
    actor?: string | null;
    note?: string | null;
    /** 현재 실험 정의 (PROMOTE 검증용) */
    experiment: Experiment | null;
  }): Promise<ExperimentLifecycleDto> {
    const state = await this.ensureState(input.feature);
    const current: LifecycleState = {
      status: state.status as ExperimentStatus,
      promotedVariant: state.promotedVariant,
    };

    let previous: LifecycleState | null = null;
    if (input.action === "ROLLBACK") {
      const last = await this.prisma.experimentEvent.findFirst({
        where: { stateId: state.id, action: { not: "ROLLBACK" } },
        orderBy: { createdAt: "desc" },
      });
      previous = last
        ? {
            status: last.fromStatus as ExperimentStatus,
            promotedVariant: last.fromVariant,
          }
        : null;
    }

    let next;
    try {
      next = applyLifecycleAction({
        current,
        action: input.action,
        variantKey: input.variantKey,
        previous,
        availableVariants: input.experiment?.variants.map((variant) =>
          variantKey(variant),
        ),
      });
    } catch (error) {
      if (error instanceof ExperimentLifecycleError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    // 상태 갱신과 이력 기록은 한 트랜잭션 — 감사 이력이 상태와 어긋나지 않는다
    await this.prisma.$transaction([
      this.prisma.experimentState.update({
        where: { id: state.id },
        data: {
          status: next.status,
          promotedVariant: next.promotedVariant,
          actor: input.actor ?? null,
          note: input.note ?? null,
        },
      }),
      this.prisma.experimentEvent.create({
        data: {
          stateId: state.id,
          action: next.action,
          fromStatus: current.status,
          toStatus: next.status,
          fromVariant: current.promotedVariant,
          toVariant: next.promotedVariant,
          actor: input.actor ?? null,
          note: input.note ?? null,
        },
      }),
    ]);

    this.logger.log(
      `실험 상태 전이 (${input.feature}): ${current.status} → ${next.status}` +
        `${next.promotedVariant ? ` [승자 ${next.promotedVariant}]` : ""}` +
        `${input.actor ? ` by ${input.actor}` : ""}`,
    );
    return this.lifecycle(input.feature);
  }

  /** feature의 상태 + 최근 전이 이력 */
  async lifecycle(feature: string): Promise<ExperimentLifecycleDto> {
    const row = await this.prisma.experimentState.findUnique({
      where: { feature },
      include: {
        events: { orderBy: { createdAt: "desc" }, take: 20 },
        _count: { select: { assignments: true } },
      },
    });
    if (!row) {
      return {
        feature,
        status: "RUNNING",
        promotedVariant: null,
        actor: null,
        note: null,
        assignmentCount: 0,
        updatedAt: null,
        events: [],
      };
    }
    return {
      feature,
      status: row.status as ExperimentStatus,
      promotedVariant: row.promotedVariant,
      actor: row.actor,
      note: row.note,
      assignmentCount: row._count.assignments,
      updatedAt: row.updatedAt.toISOString(),
      events: row.events.map(
        (event): ExperimentEventDto => ({
          id: event.id,
          action: event.action as ExperimentAction,
          fromStatus: event.fromStatus as ExperimentStatus,
          toStatus: event.toStatus as ExperimentStatus,
          fromVariant: event.fromVariant,
          toVariant: event.toVariant,
          actor: event.actor,
          note: event.note,
          createdAt: event.createdAt.toISOString(),
        }),
      ),
    };
  }

  /** Assignment Dashboard — 프로젝트별 배정 목록 (최근 순) */
  async assignments(options: {
    feature?: string;
    limit?: number;
  }): Promise<ExperimentAssignmentDto[]> {
    const rows = await this.prisma.experimentAssignment.findMany({
      where: options.feature ? { feature: options.feature } : undefined,
      orderBy: { updatedAt: "desc" },
      take: Math.min(Math.max(options.limit ?? 50, 1), 200),
    });
    const projects = await this.prisma.project.findMany({
      where: { id: { in: rows.map((row) => row.projectId) } },
      select: { id: true, name: true },
    });
    const names = new Map(projects.map((project) => [project.id, project.name]));
    return rows.map((row) => ({
      feature: row.feature,
      projectId: row.projectId,
      projectName: names.get(row.projectId) ?? null,
      variantKey: row.variantKey,
      /** 현재 정의와 서명이 다르면 다음 호출에서 재배정된다 */
      signature: row.signature,
      assignedAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** feature별 변형 배정 분포 (Assignment Dashboard 요약) */
  async distribution(
    feature: string,
  ): Promise<{ variantKey: string; projects: number }[]> {
    const rows = await this.prisma.experimentAssignment.groupBy({
      by: ["variantKey"],
      where: { feature },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      variantKey: row.variantKey,
      projects: row._count._all,
    }));
  }

  /**
   * 정의가 바뀐(서명 불일치) 배정을 정리한다 — 재배정 유도.
   * 실험 정의를 바꿨을 때 운영자가 명시적으로 호출한다.
   */
  async resetAssignments(feature: string, experiment: Experiment | null) {
    const signature = experiment ? experimentSignature(experiment) : null;
    const result = await this.prisma.experimentAssignment.deleteMany({
      where: signature
        ? { feature, signature: { not: signature } }
        : { feature },
    });
    return { removed: result.count };
  }
}
