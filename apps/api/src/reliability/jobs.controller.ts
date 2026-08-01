import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  OnModuleInit,
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
import { AnalysisBatchJob } from "./analysis-batch.job";
import { ContentBatchJob } from "./content-batch.job";
import { JobLoggerService } from "./job-logger.service";
import { JobQueueService } from "./job-queue.service";
import { JobRegistryService } from "./job-registry.service";
import { JobRunnerService } from "./job-runner.service";
import { OcrBatchJob } from "./ocr-batch.job";
import { PublishBatchJob } from "./publish-batch.job";

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
export class JobsController implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: JobRunnerService,
    private readonly ocrBatch: OcrBatchJob,
    private readonly analysisBatch: AnalysisBatchJob,
    private readonly contentBatch: ContentBatchJob,
    private readonly publishBatch: PublishBatchJob,
    private readonly registry: JobRegistryService,
    private readonly queue: JobQueueService,
    private readonly jobLog: JobLoggerService,
  ) {}

  /**
   * 종류마다 "어떻게 이어하는가"와 "항목이 몇 개인가"를 등록한다.
   *
   * 등록하지 않으면 그 종류는 **자동 이어하기에서 조용히 빠집니다.** 큐에
   * if를 늘어놓지 않는 이유가 이것입니다 — 새 작업을 만든 사람이 큐를
   * 고치는 것을 잊으면, 잊었다는 사실이 프로세스가 죽은 날에야 드러납니다.
   */
  onModuleInit(): void {
    this.registry.register(OcrBatchJob.KIND, {
      resume: (jobId, input) => {
        const ids = normalizeIds((input as { imageIds?: unknown }).imageIds, "imageIds");
        return this.runner.run(this.ocrBatch.definition({ imageIds: ids }), { imageIds: ids }, {
          resumeJobId: jobId,
        });
      },
      countItems: (input) => countOf(input, "imageIds"),
    });

    this.registry.register(AnalysisBatchJob.KIND, {
      resume: (jobId, input) => {
        const value = input as { productIds?: unknown; apply?: unknown };
        const ids = normalizeIds(value.productIds, "productIds");
        const payload = { productIds: ids, apply: value.apply === true };
        return this.runner.run(this.analysisBatch.definition(payload), payload, {
          resumeJobId: jobId,
        });
      },
      countItems: (input) => countOf(input, "productIds"),
    });

    this.registry.register(ContentBatchJob.KIND, {
      resume: (jobId, input) => {
        const value = input as { projectId?: unknown; versions?: unknown };
        const payload = {
          projectId: String(value.projectId ?? ""),
          versions: normalizeVersions(value.versions),
        };
        return this.runner.run(this.contentBatch.definition(payload), payload, {
          resumeJobId: jobId,
        });
      },
      countItems: (input) => countOf(input, "versions"),
    });

    this.registry.register(PublishBatchJob.KIND, {
      resume: (jobId, input) => {
        const value = input as {
          projectId?: unknown;
          contentIds?: unknown;
          actor?: unknown;
        };
        const payload = {
          projectId: String(value.projectId ?? ""),
          contentIds: normalizeIds(value.contentIds, "contentIds"),
          actor: typeof value.actor === "string" ? value.actor : null,
        };
        return this.runner.run(this.publishBatch.definition(payload), payload, {
          resumeJobId: jobId,
        });
      },
      countItems: (input) => countOf(input, "contentIds"),
    });
  }

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
    const ids = normalizeIds(imageIds, "imageIds");
    const result = await this.runner.run(
      this.ocrBatch.definition({ imageIds: ids }),
      { imageIds: ids },
      { actorId: request.user?.id },
    );
    return this.detail(result.jobId);
  }

  /**
   * 상품 묶음 분석 — **실제 호출이 발생하고 과금됩니다.**
   *
   * 이 저장소에서 가장 비싼 호출입니다(이미지를 첨부한 멀티모달). 이어하기가
   * 아끼는 돈이 가장 큰 자리이기도 합니다.
   */
  @Post("analysis-batch")
  @HttpCode(200)
  async runAnalysisBatch(
    @Body("productIds") productIds: unknown,
    @Body("apply") apply: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<JobDetailDto> {
    const ids = normalizeIds(productIds, "productIds");
    const payload = { productIds: ids, apply: apply === true };
    const result = await this.runner.run(
      this.analysisBatch.definition(payload),
      payload,
      { actorId: request.user?.id },
    );
    return this.detail(result.jobId);
  }

  /** 상세페이지 묶음 생성 — **실제 호출이 발생하고 과금됩니다.** */
  @Post("content-batch")
  @HttpCode(200)
  async runContentBatch(
    @Body("projectId") projectId: unknown,
    @Body("versions") versions: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<JobDetailDto> {
    if (typeof projectId !== "string" || projectId.trim() === "") {
      throw new BadRequestException("projectId를 보내 주세요.");
    }
    const payload = {
      projectId: projectId.trim(),
      versions: normalizeVersions(versions),
    };
    const result = await this.runner.run(
      this.contentBatch.definition(payload),
      payload,
      { actorId: request.user?.id },
    );
    return this.detail(result.jobId);
  }

  /**
   * 콘텐츠 묶음 발행.
   *
   * 과금은 없지만 **되돌리기가 가장 번거로운 동작**입니다. 여기서 체크포인트가
   * 하는 일은 돈을 아끼는 것이 아니라 "어디까지 나갔는가"에 답하는 것입니다.
   */
  @Post("publish-batch")
  @HttpCode(200)
  async runPublishBatch(
    @Body("projectId") projectId: unknown,
    @Body("contentIds") contentIds: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<JobDetailDto> {
    if (typeof projectId !== "string" || projectId.trim() === "") {
      throw new BadRequestException("projectId를 보내 주세요.");
    }
    const payload = {
      projectId: projectId.trim(),
      contentIds: normalizeIds(contentIds, "contentIds"),
      actor: request.user?.email ?? null,
    };
    const result = await this.runner.run(
      this.publishBatch.definition(payload),
      payload,
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
  async resume(@Param("id") id: string): Promise<JobDetailDto> {
    const row = await this.prisma.jobRun.findUnique({ where: { id } });
    if (row === null) {
      throw new NotFoundException(`작업을 찾을 수 없습니다: ${id}`);
    }
    if (row.status === "running") {
      throw new BadRequestException(
        "아직 도는 중인 작업입니다 — 같은 작업을 두 번 돌리면 과금도 두 번 됩니다.",
      );
    }
    if (!this.registry.knows(row.kind)) {
      throw new BadRequestException(
        `이어하기를 지원하지 않는 작업 종류입니다: ${row.kind}`,
      );
    }

    const result = await this.registry.resume(row.kind, id, row.input);
    return this.detail(result?.jobId ?? id);
  }

  /**
   * 자동 이어하기 상태 (TASK-4701).
   *
   * **훑기를 지금 한 번 돌리지 않습니다** — 조회가 무언가를 일으키면
   * 화면을 열 때마다 돈이 나갈 수 있습니다(4601 재전송과 같은 규칙).
   */
  @Get("queue/status")
  async queueStatus(): Promise<{
    enabled: boolean;
    kinds: string[];
    detail: string;
  }> {
    const enabled = this.queue.enabled;
    return {
      enabled,
      kinds: this.registry.kinds(),
      detail: enabled
        ? "자동 이어하기가 켜져 있습니다 — 죽은 프로세스가 남긴 작업을 큐가 되살립니다."
        : "자동 이어하기가 꺼져 있습니다 (JOB_AUTO_RESUME=on으로 켭니다) — " +
          "지금은 죽은 프로세스가 남긴 작업을 사람이 이어해야 합니다.",
    };
  }

  /**
   * 자동 이어하기를 지금 한 번 훑는다 — **사람이 눌렀을 때만.**
   *
   * 조회(`GET`)와 가르는 이유: 이 호출은 실제로 작업을 이어할 수 있고,
   * 이어하기는 돈이 나가는 호출을 합니다.
   */
  @Post("queue/sweep")
  @HttpCode(200)
  async sweepQueue(): Promise<{
    scanned: number;
    resumed: number;
    orphaned: number;
    unknownKind: number;
    detail: string;
  }> {
    const report = await this.queue.sweep();
    return {
      scanned: report.scanned,
      resumed: report.resumed,
      orphaned: report.orphaned,
      unknownKind: report.unknownKind,
      detail: report.summary,
    };
  }

  /** 최근 작업 목록 */
  @Get()
  async list(@Query("take") take?: string): Promise<{ jobs: JobRunDto[] }> {
    const bounded = Math.min(Math.max(Number(take ?? "20") || 20, 1), 100);
    const rows = await this.prisma.jobRun.findMany({
      orderBy: { startedAt: "desc" },
      take: bounded,
    });
    return {
      jobs: rows.map((row) =>
        toJobDto(row, this.registry.countItems(row.kind, row.input)),
      ),
    };
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
      costUsd: metric.costUsd === null ? null : Number(metric.costUsd),
      unpricedCalls: metric.unpricedCalls,
      ok: metric.ok,
    }));
    const perf = summarizePerf({ stages: stageMetrics, totalMs: row.totalMs ?? 0 });

    // 지금 최소 로그 등급을 함께 알려 줍니다 — debug가 안 보이는 이유가
    // "안 남겼다"인지 "등급이 높다"인지 구별할 수 있어야 합니다.
    const level = this.jobLog.level();

    return {
      job: toJobDto(row, this.registry.countItems(row.kind, row.input)),
      metrics: metrics.map(toMetricDto),
      events: events.map(toEventDto),
      perf: {
        totalMs: perf.totalMs,
        measuredMs: perf.measuredMs,
        unmeasuredMs: perf.unmeasuredMs,
        slowestStage: perf.slowest?.stage ?? null,
        inputTokens: perf.tokens.input,
        outputTokens: perf.tokens.output,
        costUsd: perf.costUsd,
        unpricedCalls: perf.unpricedCalls,
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

/**
 * 한 번에 처리할 최대 항목 수.
 *
 * 상한이 없으면 **한 번의 요청이 얼마를 쓸지 아무도 모릅니다.** 이 값은
 * 네 종류에 모두 같습니다 — 종류마다 다르게 두면 "왜 이건 50개고 저건
 * 200개지"에 답할 수 있는 사람이 곧 없어집니다.
 */
const MAX_ITEMS = 50;

function normalizeIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${field}를 배열로 보내 주세요.`);
  }
  const ids = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
  );
  if (ids.length === 0) {
    throw new BadRequestException("처리할 항목이 없습니다.");
  }
  if (ids.length > MAX_ITEMS) {
    throw new BadRequestException(
      `한 번에 최대 ${MAX_ITEMS}건까지 처리합니다 — 상한이 없으면 한 요청이 얼마를 쓸지 알 수 없습니다.`,
    );
  }
  return ids;
}

function normalizeVersions(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException("versions를 배열로 보내 주세요.");
  }
  const versions = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
  if (versions.length === 0) {
    throw new BadRequestException("처리할 버전이 없습니다.");
  }
  if (versions.length > MAX_ITEMS) {
    throw new BadRequestException(
      `한 번에 최대 ${MAX_ITEMS}건까지 처리합니다 — 상한이 없으면 한 요청이 얼마를 쓸지 알 수 없습니다.`,
    );
  }
  return versions;
}

/** 저장된 입력에서 항목 수 — 못 세면 0이며 0은 "없다"가 아니라 "모른다"다 */
function countOf(input: unknown, field: string): number {
  if (typeof input !== "object" || input === null) {
    return 0;
  }
  const value = (input as Record<string, unknown>)[field];
  return Array.isArray(value) ? value.length : 0;
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

function toJobDto(row: JobRow, totalStages: number): JobRunDto {
  const checkpoints = Array.isArray(row.checkpoints) ? row.checkpoints : [];
  const completedStages = checkpoints
    .filter((entry): entry is { stage: string; done: boolean } =>
      typeof entry === "object" && entry !== null && (entry as { done?: unknown }).done === true,
    )
    .map((entry) => entry.stage);
  // `interrupted`(서버가 멈춰 남은 작업, TASK-4701)도 이어할 수 있습니다 —
  // 그 상태는 "실패했다"가 아니라 **"끝났는지 모른다"** 이고, 끝난 단계는
  // 체크포인트에 그대로 있습니다.
  const resumable =
    (row.status === "failed" || row.status === "interrupted") &&
    row.failureKind !== null &&
    RESUMABLE_KINDS.has(row.failureKind);

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
          : row.status === "interrupted"
            ? `${completedStages.length}/${totalStages}단계까지 진행한 채로 서버가 멈췄습니다.` +
              " 끝난 단계는 체크포인트에 남아 있어 이어할 수 있습니다."
            : `${completedStages.length}/${totalStages}단계에서 멈췄습니다.` +
              (resumable
                ? " 끝난 단계는 체크포인트에 남아 있어 이어할 수 있습니다."
                : " 이어해도 같은 결과가 나오는 실패입니다 — 원인을 먼저 고쳐 주세요.")) +
      (skipped.length === 0
        ? ""
        : ` 결과를 얻지 못해 건너뛴 항목 ${skipped.length}건이 있습니다: ${skipped
            .map((entry) => skippedLabel(entry))
            .join(" · ")}.`) +
      // 전부 건너뛴 것을 "끝냈습니다"로만 적으면, 아무것도 못 얻은 실행이
      // 성공으로 읽힙니다.
      (row.status === "succeeded" && totalStages > 0 && skipped.length >= totalStages
        ? " 결과를 얻은 항목이 하나도 없습니다 — 단계는 다 밟았지만 얻은 것은 없습니다."
        : ""),
  };
}

/**
 * 건너뛴 항목의 이름.
 *
 * 종류마다 id 칸 이름이 다릅니다(`imageId` · `productId` · `version` ·
 * `contentId`). 여기서 종류를 알아내려 하면 새 작업이 생길 때마다 이 함수를
 * 고쳐야 하고, 고치는 것을 잊으면 **그 종류만 건너뛴 항목이 이름 없이**
 * 뜹니다. 그래서 **있는 칸 중 아무거나** 씁니다 — 이름을 아는 것이 목적이지
 * 어느 칸에서 왔는지는 중요하지 않습니다.
 */
function skippedLabel(row: Record<string, unknown>): string {
  for (const key of ["imageId", "productId", "contentId", "version"]) {
    const value = row[key];
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number") return `v${value}`;
  }
  return "(이름 없음)";
}

/** 체크포인트에 남은 "건너뛴 것" — 성공 안에 숨지 않게 꺼내 온다 */
function skippedOf(checkpoints: unknown): Record<string, unknown>[] {
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
    ? (output.skipped as Record<string, unknown>[])
    : [];
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
  costUsd: unknown;
  unpricedCalls: number | null;
}): JobStageMetricDto {
  return {
    stage: row.stage,
    durationMs: row.durationMs,
    ok: row.ok,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    processHeapDeltaBytes: row.processHeapDeltaBytes,
    // null은 "공짜였다"가 아니라 **"안 쟀다"** 입니다.
    costUsd: row.costUsd === null || row.costUsd === undefined ? null : Number(row.costUsd),
    unpricedCalls: row.unpricedCalls,
  };
}
