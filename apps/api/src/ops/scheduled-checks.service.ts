import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  SCHEDULED_JOBS,
  detectBudgetAlerts,
  detectConfigurationAlerts,
  detectProviderAlerts,
  detectUnpricedAlerts,
  resolveSchedules,
  validateEnvironment,
} from "@acos/core";
import type { AlertKind, JobSchedule, ScheduledJob } from "@acos/core";
import type {
  CheckRunDto,
  CheckRunResultDto,
  JobScheduleDto,
  SchedulerCoordinationDto,
} from "@acos/shared";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { ProviderProductionService } from "../llm/provider-production.service";
import { PrismaService } from "../prisma/prisma.service";
import { AlertService } from "./alert.service";
import { DistributedLockService } from "./distributed-lock.service";

interface CheckRunRow {
  id: string;
  job: string;
  ok: boolean;
  detail: string;
  alertsRaised: number;
  durationMs: number;
  trigger: string;
  createdAt: Date;
}

function toDto(row: CheckRunRow): CheckRunDto {
  return {
    id: row.id,
    job: row.job,
    ok: row.ok,
    detail: row.detail,
    alertsRaised: row.alertsRaised,
    durationMs: row.durationMs,
    trigger: row.trigger,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 점검별로 책임지는 경보 종류 — 해소 판정을 이 범위 안에서만 한다 */
const JOB_ALERT_KINDS: Record<ScheduledJob, AlertKind[]> = {
  "cost-verification": ["budget", "unpriced-model"],
  "provider-validation": ["configuration"],
  "health-check": ["provider-failure"],
};

/**
 * Scheduled Checks. (TASK-1302, Sprint 13)
 *
 * 세 가지 점검을 주기적으로 돌려 경보를 만든다:
 *
 * | 점검 | 보는 것 | 책임지는 경보 |
 * | --- | --- | --- |
 * | `cost-verification` | 비용 대조 + 예산 현황 | 예산 · 미산정 모델 |
 * | `provider-validation` | 환경 검증 + Provider 키 | 설정 |
 * | `health-check` | 운영 모니터링 | Provider 장애 |
 *
 * **점검마다 책임지는 경보 종류를 나눈 이유**: 해소 판정은 "이번에 감지되지
 * 않았다"로 하는데, 비용 점검이 돌 때 Provider 경보까지 해소해 버리면
 * 실제로는 죽어 있는 Provider가 조용히 사라진다.
 *
 * **Live Check는 하지 않는다** (CTO 결정 1301-①) — 예약 점검이 실 Provider
 * 키를 자동으로 호출하면 과금이 사람 모르게 발생한다. Health Check 점검은
 * 이미 쌓인 Execution을 읽을 뿐 새 호출을 만들지 않는다.
 *
 * 타이머는 `unref()`한다 — 예약 점검 때문에 프로세스가 종료되지 않으면
 * 배포·테스트가 멈춘다.
 */
@Injectable()
export class ScheduledChecksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledChecksService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<ScheduledJob>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly production: ProviderProductionService,
    private readonly budget: LlmBudgetService,
    private readonly alerts: AlertService,
    private readonly locks: DistributedLockService,
  ) {}

  /** 점검 1건의 잠금 이름 */
  static lockKey(job: ScheduledJob): string {
    return `scheduler:${job}`;
  }

  schedules(): JobSchedule[] {
    return resolveSchedules(process.env as Record<string, string | undefined>);
  }

  onModuleInit(): void {
    for (const schedule of this.schedules()) {
      if (!schedule.enabled) {
        continue;
      }
      const timer = setInterval(() => {
        void this.run(schedule.job, "schedule");
      }, schedule.intervalMs);
      // 예약 점검이 프로세스를 붙잡고 있으면 안 된다
      timer.unref?.();
      this.timers.push(timer);
      this.logger.log(
        `예약 점검 등록: ${schedule.job} — ${Math.round(schedule.intervalMs / 1000)}초 간격`,
      );
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers.length = 0;
  }

  /**
   * 점검 1회 실행.
   *
   * **겹쳐 돌지 않는다** — 간격보다 오래 걸리는 점검이 쌓이면 DB와 Provider에
   * 부하가 곱으로 붙는다(프로세스 내부).
   *
   * **인스턴스끼리도 겹치지 않는다** (TASK-1401, CTO 결정 1302-②) —
   * 예약 실행은 분산 잠금을 잡은 인스턴스만 수행한다. 수동 실행은 사람이
   * 지금 확인하려는 것이므로 잠금을 요구하지 않는다.
   */
  async run(
    job: ScheduledJob,
    trigger: "schedule" | "manual" = "manual",
  ): Promise<CheckRunResultDto> {
    if (this.running.has(job)) {
      return {
        job,
        ok: true,
        detail: "이전 실행이 아직 끝나지 않아 건너뜁니다.",
        alertsRaised: 0,
        durationMs: 0,
        trigger,
        notified: [],
      };
    }

    if (trigger === "schedule") {
      const leader = await this.locks.acquire(
        ScheduledChecksService.lockKey(job),
      );
      if (!leader) {
        // 다른 인스턴스가 맡았다 — 이력을 남기지 않는다(정상 동작이라 소음이다)
        return {
          job,
          ok: true,
          detail: "다른 인스턴스가 이 점검을 맡고 있어 건너뜁니다.",
          alertsRaised: 0,
          durationMs: 0,
          trigger,
          notified: [],
        };
      }
    }

    this.running.add(job);
    const startedAt = Date.now();

    try {
      const outcome = await this.execute(job);
      const durationMs = Date.now() - startedAt;
      await this.record({
        job,
        ok: outcome.ok,
        detail: outcome.detail,
        alertsRaised: outcome.notified.length,
        durationMs,
        trigger,
      });
      return {
        job,
        ok: outcome.ok,
        detail: outcome.detail,
        alertsRaised: outcome.notified.length,
        durationMs,
        trigger,
        notified: outcome.notified,
      };
    } catch (error) {
      // 점검 자체가 실패한 것도 알아야 한다 — 조용히 안 도는 점검이 가장 위험하다
      const detail = `점검 실행 실패: ${error instanceof Error ? error.message : String(error)}`;
      const durationMs = Date.now() - startedAt;
      this.logger.error(`${job} — ${detail}`);
      await this.record({
        job,
        ok: false,
        detail,
        alertsRaised: 0,
        durationMs,
        trigger,
      });
      return {
        job,
        ok: false,
        detail,
        alertsRaised: 0,
        durationMs,
        trigger,
        notified: [],
      };
    } finally {
      this.running.delete(job);
    }
  }

  /** 전체 점검 실행 (수동 트리거·배포 직후용) */
  async runAll(
    trigger: "schedule" | "manual" = "manual",
  ): Promise<CheckRunResultDto[]> {
    const results: CheckRunResultDto[] = [];
    for (const schedule of this.schedules()) {
      results.push(await this.run(schedule.job, trigger));
    }
    return results;
  }

  private async execute(
    job: ScheduledJob,
  ): Promise<{ ok: boolean; detail: string; notified: CheckRunResultDto["notified"] }> {
    if (job === "cost-verification") {
      const [cost, budgetStatus] = await Promise.all([
        this.production.verifyCost({ hours: 24 }),
        this.budget.status(),
      ]);
      const detected = [
        ...detectUnpricedAlerts(cost.issues),
        ...detectBudgetAlerts({
          daily: budgetStatus.daily,
          monthly: budgetStatus.monthly,
          alertRatio: budgetStatus.alertRatio,
        }),
      ];
      const notified = await this.alerts.sync(JOB_ALERT_KINDS[job], detected);
      return {
        ok: detected.length === 0,
        detail:
          `${cost.checked}건 검사 · 미산정 ${cost.unpricedCalls}건 · ` +
          `기록 $${cost.recordedTotal} · 경보 ${detected.length}건`,
        notified,
      };
    }

    if (job === "provider-validation") {
      // Live Check는 하지 않는다 (CTO 결정 1301-①) — 자동 과금 방지
      const [validation, env] = await Promise.all([
        this.production.validateProviders({ live: false }),
        Promise.resolve(validateEnvironment(process.env)),
      ]);
      const detected = detectConfigurationAlerts({
        envErrors: env.errors.map((issue) => ({
          name: issue.name,
          message: issue.message,
        })),
        providerBlockers: validation.blockers,
      });
      const notified = await this.alerts.sync(JOB_ALERT_KINDS[job], detected);
      return {
        ok: detected.length === 0,
        detail:
          `환경 ${env.checked}개 항목 · 오류 ${env.errors.length}건 · ` +
          `Provider 문제 ${validation.blockers.length}건`,
        notified,
      };
    }

    // health-check — 이미 쌓인 Execution으로 판정한다 (새 호출을 만들지 않는다)
    const monitor = await this.production.monitor({ minutes: 60 });
    const detected = detectProviderAlerts(monitor.providers);
    const notified = await this.alerts.sync(JOB_ALERT_KINDS[job], detected);
    return {
      ok: detected.length === 0,
      detail:
        `상태 ${monitor.status} · 호출 ${monitor.totals.calls}건 · ` +
        `Provider ${monitor.providers.length}개 · 경보 ${detected.length}건`,
      notified,
    };
  }

  private async record(entry: {
    job: string;
    ok: boolean;
    detail: string;
    alertsRaised: number;
    durationMs: number;
    trigger: string;
  }): Promise<void> {
    try {
      await this.prisma.checkRun.create({ data: entry });
    } catch (error) {
      // 이력 기록 실패가 점검을 실패시키지는 않는다 (Execution 기록과 같은 태도)
      this.logger.warn(
        `점검 이력 기록 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 예약 실행 조율 현황 (TASK-1401) */
  async coordination(): Promise<SchedulerCoordinationDto> {
    return {
      distributed: this.locks.distributed,
      instance: this.locks.self,
      lockTtlMs: this.locks.ttlMs,
      leases: await this.locks.status(
        SCHEDULED_JOBS.map((job) => ScheduledChecksService.lockKey(job)),
      ),
    };
  }

  /** 점검 구성 + 마지막 실행 결과 */
  async status(): Promise<JobScheduleDto[]> {
    const schedules = this.schedules();
    const results: JobScheduleDto[] = [];
    for (const schedule of schedules) {
      const last = (await this.prisma.checkRun.findFirst({
        where: { job: schedule.job },
        orderBy: { createdAt: "desc" },
      })) as CheckRunRow | null;
      results.push({
        job: schedule.job,
        intervalMs: schedule.intervalMs,
        enabled: schedule.enabled,
        source: schedule.source,
        env: schedule.env,
        lastRunAt: last?.createdAt.toISOString() ?? null,
        lastResult: last ? toDto(last) : null,
      });
    }
    return results;
  }
}
