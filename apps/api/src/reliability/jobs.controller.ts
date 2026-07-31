import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { analyzeStageTrend, summarizePerf } from "@acos/core";
import type { StageMetric } from "@acos/core";
import type {
  JobDetailDto,
  JobEventDto,
  JobMetricsDto,
  JobRunDto,
  JobStageMetricDto,
} from "@acos/shared";

import { AuthGuard, RequireRole } from "../auth/auth.guard";
import type { AuthenticatedRequest } from "../auth/auth.guard";
import { PrismaService } from "../prisma/prisma.service";
import { JobLoggerService } from "./job-logger.service";
import { JobRunnerService } from "./job-runner.service";
import { OcrBatchJob } from "./ocr-batch.job";

/** 재시도할 만한 실패거나 아직 도는 중이면 이어할 수 있다 */
const RESUMABLE_KINDS = new Set([
  "network",
  "timeout",
  "throttled",
  "upstream",
  "database",
  "storage",
]);

/** 이 창 안의 계측으로 추세를 낸다 */
const TREND_WINDOW_HOURS = 24 * 7;

/**
 * 작업 API. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * **기존 엔드포인트를 하나도 고치지 않습니다.** `POST /images/:id/ocr`은
 * 예전 그대로이고, 여기는 그 위에 얹히는 **묶음 작업**입니다.
 *
 * `ops.controller.ts`에 붙이지 않은 이유가 있습니다 — 그 파일은 이미
 * 라우트 69개 · 주입 서비스 36개이고, 거기에 더하면 다음 스프린트에 붙이는
 * 비용이 만드는 비용을 넘습니다(TASK-4602 조사 결과 7).
 */
@Controller("jobs")
@UseGuards(AuthGuard)
@RequireRole("ADMIN")
export class JobsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: JobRunnerService,
    private readonly ocrBatch: OcrBatchJob,
    private readonly jobLog: JobLoggerService,
  ) {}

  /**
   * 이미지 묶음 OCR을 돌린다 — **실제 호출이 발생하고 과금됩니다.**
   *
   * 중간에 죽어도 끝난 장은 체크포인트에 남고, `POST /jobs/:id/resume`으로
   * 이어할 수 있습니다.
   */
  @Post("ocr-batch")
  @HttpCode(200)
  async runOcrBatch(
    @Body("imageIds") imageIds: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<JobDetailDto> {
    const ids = normalizeIds(imageIds);
    const result = await this.runner.run(
      this.ocrBatch.definition({ imageIds: ids }),
      { imageIds: ids },
      { actorId: request.user?.id },
    );
    return this.detail(result.jobId);
  }

  /**
   * 멈춘 작업을 이어한다.
   *
   * **이어할 수 있는지는 우리가 정하지 않습니다** — `planResume`이 정하고,
   * 입력이 달라졌거나 너무 오래됐으면 처음부터 합니다. 그 판단도 결과에
   * 적힙니다.
   */
  @Post(":id/resume")
  @HttpCode(200)
  async resume(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<JobDetailDto> {
    const row = await this.prisma.jobRun.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException(`작업을 찾을 수 없습니다: ${id}`);
    }
    if (row.status === "running") {
      throw new BadRequestException(
        "아직 도는 중인 작업입니다 — 같은 작업을 두 번 돌리면 과금도 두 번 됩니다.",
      );
    }
    if (row.kind !== OcrBatchJob.KIND) {
      throw new BadRequestException(
        `이어하기를 지원하지 않는 작업 종류입니다: ${row.kind}`,
      );
    }

    const input = row.input as { imageIds?: unknown };
    const ids = normalizeIds(input.imageIds);
    const result = await this.runner.run(
      this.ocrBatch.definition({ imageIds: ids }),
      { imageIds: ids },
      { actorId: request.user?.id, resumeJobId: id },
    );
    return this.detail(result.jobId);
  }

  /** 최근 작업 목록 */
  @Get()
  async list(@Query("take") take?: string): Promise<{ jobs: JobRunDto[] }> {
    const bounded = Math.min(Math.max(Number(take ?? "20") || 20, 1), 100);
    const rows = await this.prisma.jobRun.findMany({
      orderBy: { startedAt: "desc" },
      take: bounded,
    });
    return { jobs: rows.map(toJobDto) };
  }

  /** 작업 하나 — 계측과 로그까지 */
  @Get(":id")
  async get(@Param("id") id: string): Promise<JobDetailDto> {
    return this.detail(id);
  }

  /** 작업의 로그만 */
  @Get(":id/events")
  async events(
    @Param("id") id: string,
    @Query("level") level?: string,
  ): Promise<{ events: JobEventDto[] }> {
    const rows = await this.prisma.jobEvent.findMany({
      where: { jobId: id, ...(level === undefined ? {} : { level }) },
      orderBy: { at: "asc" },
      take: 500,
    });
    return { events: rows.map(toEventDto) };
  }

  /**
   * 단계별 성능 추세.
   *
   * **표본이 적으면 판정하지 않습니다** — 한 번 느렸던 것을 "느린 단계"로
   * 적으면 그날 네트워크가 흔들린 것이 영구 결함으로 남습니다.
   */
  @Get("metrics/stages")
  async metrics(@Query("thresholdMs") thresholdMs?: string): Promise<JobMetricsDto> {
    const now = Date.now();
    const threshold = Math.max(Number(thresholdMs ?? "5000") || 5000, 1);
    const since = new Date(now - TREND_WINDOW_HOURS * 3_600_000);
    const rows = await this.prisma.jobStageMetric.findMany({
      where: { at: { gte: since } },
      orderBy: { at: "desc" },
      take: 5000,
      select: { kind: true, stage: true, durationMs: true },
    });

    // 단계 이름에 id가 붙는 작업이 있어(ocr:3:img-x) 그대로 묶으면 표본이
    // 항상 1이 됩니다. **id를 떼고 묶되, 뗐다는 사실을 이름에 남깁니다.**
    const groups = new Map<string, { kind: string; stage: string; durations: number[] }>();
    for (const row of rows) {
      const stage = generalizeStage(row.stage);
      const key = `${row.kind}::${stage}`;
      const found = groups.get(key) ?? { kind: row.kind, stage, durations: [] };
      found.durations.push(row.durationMs);
      groups.set(key, found);
    }

    const trends = [...groups.values()]
      .map((group) =>
        analyzeStageTrend({
          stage: group.stage,
          durations: group.durations,
          thresholdMs: threshold,
        }),
      )
      .map((trend, index) => ({
        kind: [...groups.values()][index].kind,
        stage: trend.stage,
        samples: trend.samples,
        medianMs: trend.medianMs,
        p95Ms: trend.p95Ms,
        verdict: trend.verdict,
        detail: trend.detail,
      }));

    const undecided = trends.filter((row) => row.verdict === "insufficient").length;
    const slow = trends.filter((row) => row.verdict === "slow");

    const parts = [`최근 ${TREND_WINDOW_HOURS / 24}일 · 단계 ${trends.length}종.`];
    if (slow.length > 0) {
      parts.push(`기준(${threshold}ms)을 넘는 단계 ${slow.length}종: ${slow.map((row) => row.stage).join(" · ")}.`);
    }
    if (undecided > 0) {
      parts.push(
        `표본이 모자라 판정하지 않은 단계 ${undecided}종 — 빠르다는 뜻이 아닙니다.`,
      );
    }
    if (trends.length === 0) {
      parts.push("아직 계측된 작업이 없습니다 — 느리다는 뜻도 빠르다는 뜻도 아닙니다.");
    }

    return {
      trends,
      undecided,
      windowHours: TREND_WINDOW_HOURS,
      detail: parts.join(" "),
      checkedAt: new Date(now).toISOString(),
    };
  }

  private async detail(id: string): Promise<JobDetailDto> {
    const row = await this.prisma.jobRun.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException(`작업을 찾을 수 없습니다: ${id}`);
    }
    const [metrics, events] = await Promise.all([
      this.prisma.jobStageMetric.findMany({ where: { jobId: id }, orderBy: { at: "asc" } }),
      this.prisma.jobEvent.findMany({ where: { jobId: id }, orderBy: { at: "asc" }, take: 200 }),
    ]);

    const stageMetrics: StageMetric[] = metrics.map((metric) => ({
      stage: metric.stage,
      durationMs: metric.durationMs,
      tokens:
        metric.inputTokens === null && metric.outputTokens === null
          ? null
          : { input: metric.inputTokens, output: metric.outputTokens },
      processHeapDeltaBytes: metric.processHeapDeltaBytes,
      ok: metric.ok,
    }));
    const perf = summarizePerf({ stages: stageMetrics, totalMs: row.totalMs ?? 0 });

    // 지금 최소 로그 등급을 함께 알려 줍니다 — debug가 안 보이는 이유가
    // "안 남겼다"인지 "등급이 높다"인지 구별할 수 있어야 합니다.
    const level = this.jobLog.level();

    return {
      job: toJobDto(row),
      metrics: metrics.map(toMetricDto),
      events: events.map(toEventDto),
      perf: {
        totalMs: perf.totalMs,
        measuredMs: perf.measuredMs,
        unmeasuredMs: perf.unmeasuredMs,
        slowestStage: perf.slowest?.stage ?? null,
        inputTokens: perf.tokens.input,
        outputTokens: perf.tokens.output,
        detail: `${perf.detail} 지금 로그 최소 등급은 ${level.level}입니다.`,
      },
    };
  }
}

/** `ocr:3:img-abc` → `ocr:*` — 뗐다는 사실을 이름에 남긴다 */
function generalizeStage(stage: string): string {
  const parts = stage.split(":");
  return parts.length <= 1 ? stage : `${parts[0]}:*`;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException("imageIds를 배열로 보내 주세요.");
  }
  const ids = value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
  if (ids.length === 0) {
    throw new BadRequestException("처리할 이미지가 없습니다.");
  }
  if (ids.length > 50) {
    // 상한이 없으면 한 번의 요청이 얼마를 쓸지 아무도 모릅니다.
    throw new BadRequestException(
      "한 번에 최대 50장까지 처리합니다 — 상한이 없으면 한 요청이 얼마를 쓸지 알 수 없습니다.",
    );
  }
  return ids;
}

interface JobRow {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  checkpoints: unknown;
  input: unknown;
  failureKind: string | null;
  userMessage: string | null;
  totalMs: number | null;
  requestId: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

function toJobDto(row: JobRow): JobRunDto {
  const checkpoints = Array.isArray(row.checkpoints) ? row.checkpoints : [];
  const completedStages = checkpoints
    .filter((entry): entry is { stage: string; done: boolean } =>
      typeof entry === "object" && entry !== null && (entry as { done?: unknown }).done === true,
    )
    .map((entry) => entry.stage);
  const totalStages = totalStagesOf(row.input);
  const resumable =
    row.status === "failed" && row.failureKind !== null && RESUMABLE_KINDS.has(row.failureKind);

  // 건너뛴 것을 detail에 밝힙니다 — "3/3 끝냈습니다"만 적으면 글자를
  // 못 읽은 이미지가 성공 안에 숨습니다(라이브에서 잡음).
  const skipped = skippedOf(row.checkpoints);

  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    completedStages,
    totalStages,
    failureKind: row.failureKind,
    userMessage: row.userMessage,
    resumable,
    totalMs: row.totalMs,
    requestId: row.requestId,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    detail:
      (row.status === "succeeded"
        ? `${completedStages.length}/${totalStages}단계를 끝냈습니다.`
        : row.status === "running"
          ? `${completedStages.length}/${totalStages}단계까지 진행했습니다.`
          : `${completedStages.length}/${totalStages}단계에서 멈췄습니다.` +
            (resumable
              ? " 끝난 단계는 체크포인트에 남아 있어 이어할 수 있습니다."
              : " 이어해도 같은 결과가 나오는 실패입니다 — 원인을 먼저 고쳐 주세요.")) +
      (skipped.length === 0
        ? ""
        : ` 결과를 얻지 못해 건너뛴 항목 ${skipped.length}건이 있습니다: ${skipped
            .map((row) => row.imageId)
            .join(" · ")}.`) +
      // 전부 건너뛴 것을 "끝냈습니다"로만 적으면, 아무것도 못 얻은 실행이
      // 성공으로 읽힙니다.
      (row.status === "succeeded" && totalStages > 0 && skipped.length >= totalStages
        ? " 결과를 얻은 항목이 하나도 없습니다 — 단계는 다 밟았지만 얻은 것은 없습니다."
        : ""),
  };
}

/** 체크포인트에 남은 "건너뛴 것" — 성공 안에 숨지 않게 꺼내 온다 */
function skippedOf(checkpoints: unknown): { imageId: string; reason: string }[] {
  if (!Array.isArray(checkpoints)) return [];
  const newest = checkpoints
    .filter(
      (entry): entry is { done: boolean; at: number; output: unknown } =>
        typeof entry === "object" && entry !== null && (entry as { done?: unknown }).done === true,
    )
    .reduce<{ at: number; output: unknown } | null>(
      (best, row) => (best === null || row.at > best.at ? row : best),
      null,
    );
  const output = (newest?.output ?? {}) as { skipped?: unknown };
  return Array.isArray(output.skipped)
    ? (output.skipped as { imageId: string; reason: string }[])
    : [];
}

function totalStagesOf(input: unknown): number {
  if (typeof input === "object" && input !== null) {
    const ids = (input as { imageIds?: unknown }).imageIds;
    if (Array.isArray(ids)) return ids.length;
  }
  return 0;
}

function toEventDto(row: {
  id: string;
  level: string;
  stage: string;
  message: string;
  data: unknown;
  at: Date;
}): JobEventDto {
  return {
    id: row.id,
    level: row.level,
    stage: row.stage,
    message: row.message,
    data: (row.data ?? {}) as Record<string, unknown>,
    at: row.at.toISOString(),
  };
}

function toMetricDto(row: {
  stage: string;
  durationMs: number;
  ok: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  processHeapDeltaBytes: number | null;
}): JobStageMetricDto {
  return {
    stage: row.stage,
    durationMs: row.durationMs,
    ok: row.ok,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    processHeapDeltaBytes: row.processHeapDeltaBytes,
  };
}
