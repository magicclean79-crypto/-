import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  SCHEDULED_JOBS,
  detectBudgetAlerts,
  detectConfigurationAlerts,
  detectProviderAlerts,
  detectSchedulerAlerts,
  detectUnpricedAlerts,
  isSchedulerStopped,
  resolveSchedules,
  shouldRun,
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
  // 보관은 경보를 만들지 않는다 — 정리 작업이다
  "alert-archive": [],
};

/** 사람이 읽는 주기 설명 (경보 문구용) */
function describeInterval(schedule: JobSchedule): string {
  if (schedule.dailyAtMinutes !== null) {
    const hours = String(Math.floor(schedule.dailyAtMinutes / 60)).padStart(2, "0");
    const minutes = String(schedule.dailyAtMinutes % 60).padStart(2, "0");
    return `매일 ${hours}:${minutes} UTC`;
  }
  return `${Math.round(schedule.intervalMs / 1000)}초`;
}

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
  private ticker: NodeJS.Timeout | null = null;
  private readonly running = new Set<ScheduledJob>();
  /** 점검별 마지막 실행 (이 인스턴스 기준) */
  private readonly lastRunAt = new Map<ScheduledJob, number>();
  private startedAt = Date.now();

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

  /**
   * 단일 티커로 모든 점검을 돌린다 (TASK-1501).
   *
   * 점검마다 타이머를 두면 **시각 기반 점검**(보관, 결정 1401-③)을 표현할 수
   * 없다. 짧은 주기로 한 번만 깨어나 각 점검의 `shouldRun`을 묻는 편이
   * 간격·시각을 한 규칙으로 다룰 수 있다.
   */
  onModuleInit(): void {
    this.startedAt = Date.now();
    const enabled = this.schedules().filter((schedule) => schedule.enabled);
    if (enabled.length === 0) {
      this.logger.warn("예약 점검이 모두 꺼져 있습니다.");
      return;
    }

    this.ticker = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
    this.ticker.unref?.();

    for (const schedule of enabled) {
      this.logger.log(
        `예약 점검 등록: ${schedule.job} — ${describeInterval(schedule)}`,
      );
    }
  }

  /** 티커 주기 — 가장 짧은 간격보다 촘촘하되 최소 1초 */
  get tickIntervalMs(): number {
    const raw = Number(process.env.OPS_TICK_INTERVAL_MS);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.round(raw);
    }
    const shortest = Math.min(
      ...this.schedules()
        .filter((schedule) => schedule.enabled && schedule.dailyAtMinutes === null)
        .map((schedule) => schedule.intervalMs),
      60_000,
    );
    return Math.max(1_000, Math.min(shortest, 60_000));
  }

  /** 한 바퀴 — 돌 때가 된 점검을 실행하고, 멈춘 점검을 감시한다 */
  async tick(): Promise<void> {
    const now = Date.now();
    for (const schedule of this.schedules()) {
      if (shouldRun(schedule, this.lastRunAt.get(schedule.job) ?? null, now)) {
        await this.run(schedule.job, "schedule");
      }
    }
    await this.watchdog();
  }

  /**
   * Scheduler Stopped Alert (CTO 결정 1401-①).
   *
   * **잠금 없이 돈다** — 예약 점검이 멈춘 원인이 대개 잠금을 못 잡는 것이라,
   * 감시까지 잠금을 요구하면 정작 알려야 할 때 알리지 못한다. 여러 인스턴스가
   * 동시에 감지해도 경보 `key`가 같아 중복되지 않는다.
   */
  async watchdog(): Promise<void> {
    if (!this.watchdogEnabled) {
      return;
    }
    const now = Date.now();
    const schedules = this.schedules();
    const jobs = await Promise.all(
      schedules.map(async (schedule) => {
        const last = await this.lastRunTime(schedule.job);
        return {
          job: schedule.job,
          stopped: isSchedulerStopped(schedule, last, now, {
            startedAt: this.startedAt,
            graceFactor: this.graceFactor,
          }),
          lastRunAt: last === null ? null : new Date(last).toISOString(),
          interval: describeInterval(schedule),
        };
      }),
    );

    const detected = detectSchedulerAlerts({
      jobs,
      lockUnavailable: this.locks.distributed && !this.locks.healthy,
    });
    await this.alerts.sync(["scheduler-stopped"], detected);
  }

  private get watchdogEnabled(): boolean {
    const value = (process.env.OPS_SCHEDULER_WATCHDOG ?? "").trim().toLowerCase();
    return !["off", "false", "0"].includes(value);
  }

  private get graceFactor(): number {
    const raw = Number(process.env.OPS_SCHEDULER_GRACE_FACTOR);
    return Number.isFinite(raw) && raw > 0 ? raw : 3;
  }

  /** 마지막 실행 시각 — 인스턴스 메모리보다 DB가 진실이다(다중 인스턴스) */
  private async lastRunTime(job: ScheduledJob): Promise<number | null> {
    try {
      const row = (await this.prisma.checkRun.findFirst({
        where: { job },
        orderBy: { createdAt: "desc" },
      })) as CheckRunRow | null;
      return row?.createdAt.getTime() ?? null;
    } catch {
      return this.lastRunAt.get(job) ?? null;
    }
  }

  onModuleDestroy(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
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
    this.lastRunAt.set(job, Date.now());
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

    if (job === "alert-archive") {
      // 보관은 경보를 만들지 않는다 — 정리 작업이다 (CTO 결정 1401-③)
      const result = await this.alerts.archive();
      return {
        ok: true,
        detail:
          `보관 ${result.archived}건 (해소 후 ${result.afterDays}일 경과, ` +
          `검사 ${result.checked}건) — 삭제하지 않습니다`,
        notified: [],
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
      lockHealthy: this.locks.healthy,
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
        dailyAtMinutes: schedule.dailyAtMinutes,
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
