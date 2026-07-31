import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  incidentDuration,
  summarizeIncidents,
  validateIncident,
  validateResolution,
} from "@acos/core";
import type {
  IncidentComponent,
  IncidentRecord,
  IncidentSeverity,
} from "@acos/core";
import type { IncidentBoardDto, IncidentDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";

/**
 * 운영 장애 이력. (TASK-3701, Sprint 37 — CTO 정책 3701-④)
 *
 * **장애는 사람이 엽니다.** 경보(`Alert`)는 자동으로 뜨는 신호이고, 장애는
 * "사용자가 무엇을 못 했다"를 사람이 선언한 사건입니다. 경보에서 장애를
 * 자동으로 뽑아내려는 시도는 늘 둘 중 하나로 끝납니다 — 아무것도 아닌 것이
 * 장애가 되거나, 조용히 지나간 진짜 장애가 빠지거나.
 *
 * 성립 판단(무엇이 기록될 수 있고 무엇이 닫힐 수 있는가)은 `@acos/core`의
 * 순수 함수가 하고, 여기서는 읽고 쓰기만 합니다.
 */
@Injectable()
export class IncidentService {
  private readonly logger = new Logger(IncidentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async board(limit = 50): Promise<IncidentBoardDto> {
    const rows = await this.prisma.incident.findMany({
      orderBy: { startedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });
    const incidents = rows.map(toRecord);
    const summary = summarizeIncidents(incidents);

    return {
      incidents: incidents.map(toDto),
      open: summary.open.length,
      resolved: summary.resolvedCount,
      mttrMs: summary.mttrMs,
      mttdMs: summary.mttdMs,
      totalDowntimeMs: summary.totalDowntimeMs,
      withoutCause: summary.withoutCause,
      longestId: summary.longest?.incident.id ?? null,
      detail: summary.detail,
      checkedAt: new Date().toISOString(),
    };
  }

  /** 장애를 연다 — 성립하지 않는 기록은 만들지 않는다 */
  async open(input: {
    component: string;
    severity: string;
    summary: string;
    startedAt: string;
    detectedAt?: string | null;
    cause?: string | null;
    actorId?: string;
  }): Promise<IncidentDto> {
    const startedAt = new Date(input.startedAt);
    const detectedAt =
      input.detectedAt === undefined || input.detectedAt === null || input.detectedAt === ""
        ? null
        : new Date(input.detectedAt);
    if (detectedAt !== null && Number.isNaN(detectedAt.getTime())) {
      throw new BadRequestException("알아챈 시각이 올바르지 않습니다.");
    }

    const check = validateIncident({
      component: input.component,
      severity: input.severity,
      summary: input.summary,
      startedAt,
      detectedAt,
    });
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    const created = await this.prisma.incident.create({
      data: {
        component: input.component,
        severity: input.severity,
        summary: input.summary.trim(),
        startedAt,
        detectedAt,
        cause: input.cause?.trim() || null,
        openedById: input.actorId ?? null,
      },
    });
    this.logger.warn(
      `장애 기록 생성 [${created.severity}/${created.component}] ${created.summary}`,
    );
    return toDto(toRecord(created));
  }

  /**
   * 장애를 닫는다 — **복구 방법 없이는 닫히지 않습니다.**
   *
   * 무엇으로 살렸는지 적히지 않은 종료 기록은 다음 장애 때 아무 도움이
   * 되지 않습니다 (CTO 정책 3701-④).
   */
  async resolve(
    id: string,
    input: { resolvedAt?: string; recovery: string; cause?: string | null; actorId?: string },
  ): Promise<IncidentDto> {
    const row = await this.prisma.incident.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException("그런 장애 기록이 없습니다.");
    }

    const resolvedAt =
      input.resolvedAt === undefined || input.resolvedAt === ""
        ? new Date()
        : new Date(input.resolvedAt);
    const check = validateResolution({
      incident: toRecord(row),
      resolvedAt,
      recovery: input.recovery ?? "",
    });
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    const updated = await this.prisma.incident.update({
      where: { id },
      data: {
        resolvedAt,
        recovery: input.recovery.trim(),
        // 원인은 열 때 몰랐다가 닫을 때 알게 되는 것이 보통이다.
        // 다만 **비어 있는 값으로 지우지는 않는다** — 이미 적힌 것을 공백이
        // 덮어 쓰면 조사 결과가 사라진다.
        cause: input.cause?.trim() || row.cause,
        resolvedById: input.actorId ?? null,
      },
    });
    this.logger.log(`장애 복구 기록 [${updated.component}] ${updated.summary}`);
    return toDto(toRecord(updated));
  }
}

function toRecord(row: {
  id: string;
  component: string;
  severity: string;
  summary: string;
  startedAt: Date;
  detectedAt: Date | null;
  resolvedAt: Date | null;
  cause: string | null;
  recovery: string | null;
}): IncidentRecord {
  return {
    id: row.id,
    component: row.component as IncidentComponent,
    severity: row.severity as IncidentSeverity,
    summary: row.summary,
    startedAt: row.startedAt,
    detectedAt: row.detectedAt,
    resolvedAt: row.resolvedAt,
    cause: row.cause,
    recovery: row.recovery,
  };
}

function toDto(incident: IncidentRecord): IncidentDto {
  const duration = incidentDuration(incident);
  return {
    id: incident.id,
    component: incident.component,
    severity: incident.severity,
    summary: incident.summary,
    startedAt: incident.startedAt.toISOString(),
    detectedAt: incident.detectedAt?.toISOString() ?? null,
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    cause: incident.cause,
    recovery: incident.recovery,
    durationMs: duration.ms,
    ongoing: duration.ongoing,
    detectionMs: duration.detectionMs,
    recoveryMs: duration.recoveryMs,
    durationLabel: duration.label,
  };
}
