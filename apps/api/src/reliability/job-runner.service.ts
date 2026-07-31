import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  classifyFailure,
  fingerprintInput,
  planJobRetry,
  planResume,
  resolveJobRetryPolicy,
  summarizePerf,
} from "@acos/core";
import type { Checkpoint, JobRetryPolicy, StageMetric } from "@acos/core";

import { PrismaService } from "../prisma/prisma.service";
import { RequestContextService } from "../common/request-context.service";
import { JobContextService } from "./job-context.service";
import { JobLoggerService } from "./job-logger.service";

/** 한 단계가 하는 일 */
export interface JobStage<TState> {
  name: string;
  /**
   * 이 단계가 걸리는 최대 시간 (ms). 넘으면 중단합니다 — **끝나지 않는
   * 단계는 실패보다 나쁩니다.** 실패는 알림이 오지만 멈춰 있는 것은
   * 아무도 모릅니다.
   */
  timeoutMs?: number;
  run: (state: TState, signal: AbortSignal) => Promise<TState>;
  /** 이 단계가 쓴 토큰 — 모르면 null (0이 아닙니다) */
  tokensOf?: (state: TState) => { input: number | null; output: number | null } | null;
}

export interface JobDefinition<TInput, TState> {
  kind: string;
  stages: JobStage<TState>[];
  /** 처음 상태 */
  initial: (input: TInput) => TState;
  /** 체크포인트에 담을 값 — **작아야 합니다.** 본문을 넣지 않습니다. */
  snapshot: (state: TState) => unknown;
  /** 체크포인트에서 상태를 되살린다 */
  restore: (input: TInput, checkpoints: Checkpoint[]) => TState;
}

export interface JobResult {
  jobId: string;
  status: "succeeded" | "failed";
  completedStages: string[];
  resumedFrom: string | null;
  attempts: number;
  totalMs: number;
  failureKind: string | null;
  userMessage: string | null;
  detail: string;
}

/**
 * 작업 실행기. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * 네 가지를 한자리에서 합니다: **타임아웃 · 재시도 · 체크포인트 · 계측.**
 *
 * ## 왜 실행기를 따로 두는가
 *
 * 이 네 가지를 호출 지점마다 손으로 붙이면 **붙이는 것을 잊은 경로가
 * 생깁니다.** 그리고 그 경로는 잘 돌 때는 티가 안 나고, 사고가 난 날에만
 * 드러납니다. 한자리에 두면 **잊을 자리가 없습니다.**
 *
 * ## 기존 기능을 고치지 않습니다
 *
 * 실행기는 기존 서비스를 **부르기만** 합니다. `OcrService`도
 * `ContentsService`도 그대로입니다 — 이 클래스는 그 위에 얹히는 껍질이고,
 * 기존 엔드포인트는 이 껍질 없이 예전처럼 동작합니다.
 *
 * ## 판정은 전부 core가 합니다
 *
 * 언제 재시도할지(`planJobRetry`), 이어할 수 있는지(`planResume`), 성능을
 * 어떻게 읽을지(`summarizePerf`)는 순수 함수입니다. 여기서는 그 판정을
 * **실행**할 뿐입니다.
 */
@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger(JobRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: JobContextService,
    private readonly jobLog: JobLoggerService,
    private readonly requests: RequestContextService,
  ) {}

  get retryPolicy(): JobRetryPolicy {
    const resolved = resolveJobRetryPolicy(process.env as Record<string, string | undefined>);
    if (resolved.rejected.length > 0) {
      this.logger.warn(
        `재시도 설정에 읽을 수 없는 값이 있어 기본값으로 둡니다: ${resolved.rejected.join(" · ")}`,
      );
    }
    return resolved.policy;
  }

  /** 테스트에서 대기 없이 돌리기 위한 훅 */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }

  /**
   * 새 작업을 시작한다.
   *
   * `resumeJobId`를 주면 **이어합니다** — 다만 이어할 수 있는지는
   * `planResume`이 정하고, 안 되면 처음부터 합니다.
   */
  async run<TInput, TState>(
    definition: JobDefinition<TInput, TState>,
    input: TInput,
    options: { actorId?: string; resumeJobId?: string } = {},
  ): Promise<JobResult> {
    const fingerprint = fingerprintInput(input as unknown);
    const stageNames = definition.stages.map((stage) => stage.name);

    const existing =
      options.resumeJobId === undefined
        ? null
        : await this.prisma.jobRun
            .findUnique({ where: { id: options.resumeJobId } })
            .catch(() => null);

    const plan = planResume({
      stages: stageNames,
      checkpoints: existing === null ? [] : toCheckpoints(existing.checkpoints),
      fingerprint,
      savedFingerprint: existing?.fingerprint ?? null,
      now: Date.now(),
    });

    // 이어할 때는 같은 행에 이어 씁니다 — 새 행을 만들면 "몇 번 만에
    // 됐는가"가 흩어지고, 앞의 시도가 없던 일이 됩니다.
    //
    // **끝난 단계가 하나도 없어도 같은 행입니다** (라이브에서 잡음).
    // `planResume`은 그때 `fresh`를 돌려주는데, 그것은 "건너뛸 것이
    // 없다"는 뜻이지 "다른 작업"이라는 뜻이 아닙니다. 첫 단계에서 죽은
    // 작업을 이어했더니 새 행이 생기고 앞의 실패가 영영 `failed`로 남는
    // 것을 실측했습니다.
    //
    // 다만 **입력이 달라졌거나 너무 오래됐으면 새 행**입니다 — 그건 정말로
    // 다른 작업입니다.
    const continues =
      existing !== null &&
      existing.fingerprint === fingerprint &&
      (plan.verdict === "resume" || plan.verdict === "fresh");
    const jobId = continues ? existing.id : randomUUID();
    const attempts = continues ? existing.attempts + 1 : 1;
    const carried = plan.verdict === "resume" ? plan.completedStages : [];

    if (plan.verdict === "already-complete") {
      return {
        jobId: existing!.id,
        status: "succeeded",
        completedStages: stageNames,
        resumedFrom: null,
        attempts: existing!.attempts,
        totalMs: existing!.totalMs ?? 0,
        failureKind: null,
        userMessage: null,
        detail: plan.detail,
      };
    }

    const keptCheckpoints =
      plan.verdict === "resume"
        ? toCheckpoints(existing!.checkpoints).filter((row) =>
            carried.includes(row.stage) && row.done,
          )
        : [];

    await this.persistStart({
      jobId,
      kind: definition.kind,
      input,
      fingerprint,
      checkpoints: keptCheckpoints,
      attempts,
      actorId: options.actorId,
      resumed: continues,
    });

    return this.context.run({ jobId, kind: definition.kind, stage: "start" }, async () => {
      this.jobLog.info(
        plan.verdict === "resume" ? "작업을 이어합니다." : "작업을 시작합니다.",
        { kind: definition.kind, attempts, resume: plan.verdict, plan: plan.detail },
      );

      const startedAt = Date.now();
      const metrics: StageMetric[] = [];
      let state =
        plan.verdict === "resume"
          ? definition.restore(input, keptCheckpoints)
          : definition.initial(input);
      const checkpoints = [...keptCheckpoints];
      const completed = [...carried];

      for (const stage of definition.stages) {
        if (completed.includes(stage.name)) {
          // 이미 끝난 단계는 다시 사지 않습니다.
          this.jobLog.debug("이미 끝난 단계라 건너뜁니다.", { stage: stage.name });
          continue;
        }

        this.context.setStage(stage.name);
        const outcome = await this.runStage(definition, stage, state);
        metrics.push(outcome.metric);
        await this.persistMetric(jobId, definition.kind, outcome.metric);

        if (!outcome.ok) {
          const decision = planJobRetry(outcome.error, attempts, this.retryPolicy);
          this.jobLog.error("단계가 실패했습니다.", {
            stage: stage.name,
            kind: decision.verdict.kind,
            retriable: decision.verdict.retriable,
            reason: decision.reason,
            // 운영자용 원문은 남깁니다 — 여기서 뭉개면 장애 때 로그를
            // 손으로 뒤지게 됩니다.
            detail: decision.verdict.operatorDetail,
          });

          const totalMs = Date.now() - startedAt;
          await this.persistFailure({
            jobId,
            checkpoints,
            totalMs,
            verdict: decision.verdict,
            // **재시도할 수 있으면 그 사실을 기록에 남깁니다** — 다음에
            // 이어할 수 있는지 사람이 알아야 합니다.
            retryHint: decision.reason,
          });

          return {
            jobId,
            status: "failed" as const,
            completedStages: completed,
            resumedFrom: plan.verdict === "resume" ? plan.nextStage : null,
            attempts,
            totalMs,
            failureKind: decision.verdict.kind,
            userMessage: decision.verdict.userMessage,
            detail:
              `"${stage.name}" 단계에서 멈췄습니다. ${decision.reason}` +
              (decision.retry
                ? ` 끝난 ${completed.length}단계는 체크포인트에 남아 있어 이어할 수 있습니다.`
                : ""),
          };
        }

        state = outcome.state;
        completed.push(stage.name);
        checkpoints.push({
          stage: stage.name,
          done: true,
          output: definition.snapshot(state),
          at: Date.now(),
        });
        await this.persistCheckpoint(jobId, checkpoints);
        this.jobLog.info("단계를 끝냈습니다.", {
          stage: stage.name,
          durationMs: outcome.metric.durationMs,
        });
      }

      const totalMs = Date.now() - startedAt;
      const perf = summarizePerf({ stages: metrics, totalMs });
      this.jobLog.info("작업을 끝냈습니다.", { totalMs, perf: perf.detail });
      await this.persistSuccess(jobId, checkpoints, totalMs);

      return {
        jobId,
        status: "succeeded" as const,
        completedStages: completed,
        resumedFrom: plan.verdict === "resume" ? plan.nextStage : null,
        attempts,
        totalMs,
        failureKind: null,
        userMessage: null,
        detail: perf.detail,
      };
    });
  }

  /**
   * 단계 1개 — 시간 제한과 계측을 붙인다.
   *
   * **던지지 않습니다.** 실패를 결과로 돌려주는 이유는, 던지면 그 위에서
   * 계측이 유실되기 때문입니다 — 실패한 단계가 얼마나 걸렸는지가 가장
   * 알고 싶은 값인데도요.
   */
  private async runStage<TInput, TState>(
    definition: JobDefinition<TInput, TState>,
    stage: JobStage<TState>,
    state: TState,
  ): Promise<
    | { ok: true; state: TState; metric: StageMetric }
    | { ok: false; error: unknown; metric: StageMetric }
  > {
    const startedAt = Date.now();
    const heapBefore = process.memoryUsage().heapUsed;
    const controller = new AbortController();
    const timeoutMs = stage.timeoutMs ?? 60_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    try {
      const next = await Promise.race([
        stage.run(state, controller.signal),
        // 단계가 signal을 안 보더라도 우리는 기다림을 끝냅니다 — 끝나지
        // 않는 단계는 실패보다 나쁩니다.
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            const error = new Error(`${timeoutMs}ms 안에 끝나지 않아 중단했습니다`);
            error.name = "AbortError";
            reject(error);
          });
        }),
      ]);
      return {
        ok: true,
        state: next,
        metric: this.metric(stage, next, startedAt, heapBefore, true),
      };
    } catch (error) {
      return {
        ok: false,
        error,
        metric: this.metric(stage, state, startedAt, heapBefore, false),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private metric<TState>(
    stage: JobStage<TState>,
    state: TState,
    startedAt: number,
    heapBefore: number,
    ok: boolean,
  ): StageMetric {
    return {
      stage: stage.name,
      durationMs: Date.now() - startedAt,
      tokens: stage.tokensOf?.(state) ?? null,
      // **이 단계가 쓴 메모리가 아닙니다** — 프로세스 전체 값입니다.
      processHeapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
      ok,
    };
  }

  // ── 기록 (실패해도 작업을 죽이지 않는다) ─────────────────────

  private async persistStart(input: {
    jobId: string;
    kind: string;
    input: unknown;
    fingerprint: string;
    checkpoints: Checkpoint[];
    attempts: number;
    actorId?: string;
    resumed: boolean;
  }): Promise<void> {
    const requestId = this.requests.current()?.requestId ?? null;
    await this.safe("작업 시작 기록", async () => {
      if (input.resumed) {
        await this.prisma.jobRun.update({
          where: { id: input.jobId },
          data: {
            status: "running",
            attempts: input.attempts,
            checkpoints: input.checkpoints as never,
            failureKind: null,
            lastError: null,
            userMessage: null,
            completedAt: null,
          },
        });
        return;
      }
      await this.prisma.jobRun.create({
        data: {
          id: input.jobId,
          kind: input.kind,
          status: "running",
          input: (input.input ?? {}) as never,
          fingerprint: input.fingerprint,
          checkpoints: input.checkpoints as never,
          attempts: input.attempts,
          actorId: input.actorId ?? null,
          requestId,
        },
      });
    });
  }

  private async persistCheckpoint(jobId: string, checkpoints: Checkpoint[]): Promise<void> {
    await this.safe("체크포인트 기록", () =>
      this.prisma.jobRun.update({
        where: { id: jobId },
        data: { checkpoints: checkpoints as never },
      }),
    );
  }

  private async persistMetric(
    jobId: string,
    kind: string,
    metric: StageMetric,
  ): Promise<void> {
    await this.safe("계측 기록", () =>
      this.prisma.jobStageMetric.create({
        data: {
          jobId,
          kind,
          stage: metric.stage,
          durationMs: metric.durationMs,
          ok: metric.ok,
          inputTokens: metric.tokens?.input ?? null,
          outputTokens: metric.tokens?.output ?? null,
          processHeapDeltaBytes: metric.processHeapDeltaBytes,
        },
      }),
    );
  }

  private async persistSuccess(
    jobId: string,
    checkpoints: Checkpoint[],
    totalMs: number,
  ): Promise<void> {
    await this.safe("작업 완료 기록", () =>
      this.prisma.jobRun.update({
        where: { id: jobId },
        data: {
          status: "succeeded",
          checkpoints: checkpoints as never,
          totalMs,
          completedAt: new Date(),
        },
      }),
    );
  }

  private async persistFailure(input: {
    jobId: string;
    checkpoints: Checkpoint[];
    totalMs: number;
    verdict: ReturnType<typeof classifyFailure>;
    retryHint: string;
  }): Promise<void> {
    await this.safe("작업 실패 기록", () =>
      this.prisma.jobRun.update({
        where: { id: input.jobId },
        data: {
          status: "failed",
          checkpoints: input.checkpoints as never,
          totalMs: input.totalMs,
          failureKind: input.verdict.kind,
          lastError: `${input.verdict.operatorDetail} / ${input.retryHint}`,
          userMessage: input.verdict.userMessage,
          completedAt: new Date(),
        },
      }),
    );
  }

  private async safe(label: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      // 기록 실패가 작업을 죽이지 않습니다 — 다만 조용히 넘어가지도
      // 않습니다.
      this.logger.warn(`${label}에 실패했습니다: ${String(error)}`);
    }
  }
}

function toCheckpoints(value: unknown): Checkpoint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (row): row is Checkpoint =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as Checkpoint).stage === "string" &&
      typeof (row as Checkpoint).done === "boolean",
  );
}
