import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { HEARTBEAT_STALE_MS, selectAutoResumes } from "@acos/core";
import type { AutoResumeDecision, QueuedJob } from "@acos/core";

import { PrismaService } from "../prisma/prisma.service";
import { RequestContextService } from "../common/request-context.service";
import { JobRegistryService } from "./job-registry.service";

/**
 * 자동 이어하기 큐. (TASK-4701, Sprint 47 — 지시 3)
 *
 * ## 무엇을 고치는가
 *
 * TASK-4603의 이어하기는 **사람이 눌러야** 동작했습니다. 프로세스가 죽으면
 * 그 순간 돌던 작업은 `running`인 채로 남고, 아무도 그 행을 보지 않으면
 * 작업은 끝나지 않은 채 끝난 것처럼 있습니다. 배포 한 번에 조용히 사라지는
 * 작업이 있다는 뜻입니다.
 *
 * ## 큐를 따로 만들지 않았습니다
 *
 * Redis 큐를 놓을 수도 있었습니다. 그러지 않은 이유는 **같은 사실이 두 군데
 * 살면 언젠가 어긋나기** 때문입니다 — `job_runs`에 "실패했다"고 적혀 있는데
 * 큐에는 항목이 없거나, 큐에는 있는데 행은 이미 성공인 상태가 생깁니다.
 * 그때 어느 쪽이 맞는지 아무도 답할 수 없습니다.
 *
 * 그래서 **`job_runs` 자체가 큐**입니다. 이어할 것을 고르는 일은 조건에 맞는
 * 행을 찾는 일이고, "내가 가져간다"는 선언은 **조건부 갱신 한 번**입니다.
 *
 * ## 두 인스턴스가 같은 작업을 집으면
 *
 * 조건부 갱신(`updateMany` + `where`에 지금 상태)으로 막습니다. 진 쪽은
 * 갱신 건수 0을 받고 물러납니다 — 잠금 서버 없이도 정확하고, Redis가
 * 없는 배포에서도 같은 보장이 섭니다.
 *
 * ## 무엇을 하지 않는가
 *
 * - **살아 있는 작업은 건드리지 않습니다** (심장박동).
 * - **다시 해도 같은 실패는 자동으로 안 돌립니다** — 예산·권한·잘못된 입력.
 * - **한 번에 5건까지** — 장애가 끝난 순간 밀린 작업이 한꺼번에 돌면 그
 *   청구서도 한꺼번에 옵니다.
 * - **상한에 닿으면 그만두되 행을 지우지 않습니다.**
 */

/** 훑는 주기 — 심장박동 죽음 판정(90초)보다 자주 볼 이유가 없습니다 */
const SWEEP_INTERVAL_MS = 60_000;

/** 한 번에 살펴볼 행 수 — 전부 읽으면 오래된 장애 뒤에 한 번에 수천 건입니다 */
const SCAN_LIMIT = 200;

export interface SweepReport {
  scanned: number;
  resumed: number;
  orphaned: number;
  /** 등록되지 않은 종류라 손대지 못한 작업 */
  unknownKind: number;
  decisions: AutoResumeDecision[];
  summary: string;
}

@Injectable()
export class JobQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobQueueService.name);
  private timer: NodeJS.Timeout | null = null;
  /** 지금 훑는 중인가 — 한 프로세스 안에서 두 번 겹치지 않게 */
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobRegistryService,
    private readonly requests: RequestContextService,
  ) {}

  /** 자동 이어하기를 켤 것인가 — 기본은 **꺼짐** */
  get enabled(): boolean {
    // 기본을 꺼짐으로 둔 이유: 자동 이어하기는 아무도 안 보는 사이에 돈이
    // 나가는 호출을 합니다. 켜는 것은 그 사실을 아는 사람이 하는 결정이어야
    // 하고, "기본값이라 켜져 있었다"는 그 결정이 아닙니다.
    return process.env.JOB_AUTO_RESUME === "on";
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        "자동 이어하기가 꺼져 있습니다 (JOB_AUTO_RESUME=on으로 켭니다) — " +
          "죽은 프로세스가 남긴 작업은 사람이 이어해야 합니다.",
      );
      return;
    }
    // 기동 직후 한 번 봅니다. 방금 죽었다 살아난 것이 이 프로세스일 수
    // 있고, 그때 남아 있는 작업이 가장 급합니다.
    void this.sweep().catch((error) =>
      this.logger.warn(`첫 훑기에 실패했습니다: ${String(error)}`),
    );
    this.timer = setInterval(() => {
      void this.sweep().catch((error) =>
        this.logger.warn(`훑기에 실패했습니다: ${String(error)}`),
      );
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 한 번 훑는다.
   *
   * **판정은 core가 합니다** (`selectAutoResumes`). 여기서는 그 판정을
   * 실행할 뿐이며, 여기서 다시 판단하면 같은 사실에 두 개의 답이 생깁니다.
   */
  async sweep(now: number = Date.now()): Promise<SweepReport> {
    if (this.sweeping) {
      return empty("앞선 훑기가 아직 끝나지 않아 이번 차례는 건너뜁니다.");
    }
    this.sweeping = true;
    try {
      return await this.sweepOnce(now);
    } finally {
      this.sweeping = false;
    }
  }

  private async sweepOnce(now: number): Promise<SweepReport> {
    const rows = await this.prisma.jobRun.findMany({
      where: {
        // 끝난 작업은 보지 않습니다 — 목록이 커질수록 훑기가 느려지고,
        // 느린 훑기는 곧 꺼집니다.
        status: { in: ["running", "failed", "interrupted"] },
        startedAt: { gte: new Date(now - 24 * 3_600_000) },
      },
      orderBy: { startedAt: "asc" },
      take: SCAN_LIMIT,
    });

    const jobs: QueuedJob[] = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status as QueuedJob["status"],
      failureKind: row.failureKind,
      autoResumeRounds: row.autoResumeRounds,
      heartbeatAt: row.heartbeatAt?.getTime() ?? null,
      startedAt: row.startedAt.getTime(),
      updatedAt: (row.autoResumeAt ?? row.updatedAt).getTime(),
    }));

    const plan = selectAutoResumes(jobs, now);

    // 죽은 프로세스가 남긴 것을 먼저 표시합니다. 표시만 하고 이번 차례에
    // 돌리지는 않습니다 — 다음 훑기에서 `failed`가 아닌 `interrupted`로서
    // 다시 판정받습니다. 한 번에 "죽었다고 판단"하고 "바로 돌린다"를 같이
    // 하면, 잘못 판단했을 때 되돌릴 틈이 없습니다.
    let orphaned = 0;
    for (const decision of plan.decisions) {
      if (decision.verdict !== "orphaned") {
        continue;
      }
      if (await this.markInterrupted(decision.jobId)) {
        orphaned += 1;
        this.logger.warn(
          `작업 ${decision.jobId}: ${decision.reason} 중단됨으로 표시했습니다.`,
        );
      }
    }

    let resumed = 0;
    let unknownKind = 0;
    for (const decision of plan.resume) {
      const row = rows.find((candidate) => candidate.id === decision.jobId);
      if (row === undefined) {
        continue;
      }
      if (!this.registry.knows(row.kind)) {
        // 모르는 종류를 비슷한 것으로 대신 돌리지 않습니다.
        unknownKind += 1;
        this.logger.warn(
          `작업 ${row.id}의 종류 "${row.kind}"를 이어하는 법이 등록돼 있지 않습니다 — ` +
            `이어하지 않고 그대로 둡니다.`,
        );
        continue;
      }
      if (await this.claim(row.id, row.status, row.autoResumeRounds)) {
        resumed += 1;
        void this.runResume(row.id, row.kind, row.input);
      }
    }

    const summary =
      `${plan.summary}` +
      (orphaned > 0 ? ` 중단됨으로 표시한 작업 ${orphaned}건.` : "") +
      (unknownKind > 0
        ? ` 이어하는 법을 모르는 종류 ${unknownKind}건은 손대지 않았습니다.`
        : "");

    if (resumed > 0 || orphaned > 0 || unknownKind > 0) {
      this.logger.log(summary);
    }

    return {
      scanned: rows.length,
      resumed,
      orphaned,
      unknownKind,
      decisions: plan.decisions,
      summary,
    };
  }

  /**
   * "내가 가져간다"를 선언한다 — **조건부 갱신 한 번.**
   *
   * `where`에 지금 상태를 그대로 담습니다. 다른 인스턴스가 먼저 가져갔다면
   * 그 사이에 값이 달라져 있고, 갱신 건수가 0이 됩니다. 진 쪽은 물러납니다.
   */
  private async claim(
    jobId: string,
    status: string,
    rounds: number,
  ): Promise<boolean> {
    try {
      const result = await this.prisma.jobRun.updateMany({
        where: { id: jobId, status, autoResumeRounds: rounds },
        data: {
          autoResumeRounds: rounds + 1,
          autoResumeAt: new Date(),
        },
      });
      return result.count === 1;
    } catch (error) {
      this.logger.warn(`작업 ${jobId}를 가져오지 못했습니다: ${String(error)}`);
      return false;
    }
  }

  /** 심장박동이 멈춘 작업을 중단됨으로 표시한다 (같은 조건부 갱신) */
  private async markInterrupted(jobId: string): Promise<boolean> {
    try {
      const result = await this.prisma.jobRun.updateMany({
        where: {
          id: jobId,
          status: "running",
          // 표시하는 사이에 박동이 돌아왔으면 손대지 않습니다.
          OR: [
            { heartbeatAt: null },
            { heartbeatAt: { lt: new Date(Date.now() - HEARTBEAT_STALE_MS) } },
          ],
        },
        data: {
          status: "interrupted",
          failureKind: "timeout",
          userMessage:
            "작업을 돌리던 서버가 멈춰 중단됐습니다. 끝난 단계는 남아 있어 이어할 수 있습니다.",
          lastError: "심장박동이 멈춰 중단된 것으로 표시했습니다 (TASK-4701).",
        },
      });
      return result.count === 1;
    } catch (error) {
      this.logger.warn(`작업 ${jobId}를 표시하지 못했습니다: ${String(error)}`);
      return false;
    }
  }

  /**
   * 실제로 이어한다.
   *
   * **새 요청 id를 세워서 돌립니다.** 그러지 않으면 이 실행이 부른 호출이
   * 어느 요청에도 묶이지 않고, 그러면 단계별 비용을 잴 수 없습니다
   * (`TokenMeterService`는 끈이 없으면 재지 않습니다).
   */
  private async runResume(jobId: string, kind: string, input: unknown): Promise<void> {
    const requestId = `auto-resume-${randomUUID()}`;
    try {
      await this.requests.run({ requestId, traceId: requestId }, async () => {
        const result = await this.registry.resume(kind, jobId, input);
        if (result === null) {
          return;
        }
        this.logger.log(
          `작업 ${jobId}를 자동으로 이어했습니다 — ${result.status} (${result.detail})`,
        );
      });
    } catch (error) {
      // 이어하기가 또 실패하는 것은 정상입니다 — 다음 훑기에서 상한까지
      // 다시 판정받습니다. 다만 조용히 넘어가지는 않습니다.
      this.logger.warn(`작업 ${jobId}를 이어하다 실패했습니다: ${String(error)}`);
    }
  }
}

function empty(summary: string): SweepReport {
  return {
    scanned: 0,
    resumed: 0,
    orphaned: 0,
    unknownKind: 0,
    decisions: [],
    summary,
  };
}
