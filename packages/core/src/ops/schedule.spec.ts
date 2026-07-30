import {
  DEFAULT_GRACE_FACTOR,
  DEFAULT_JOB_INTERVALS,
  PRODUCTION_ONLY_JOBS,
  defaultRpoTargetMs,
  isSchedulerStopped,
  resolveGraceFactor,
  parseDailyAt,
  parseIntervalMs,
  resolveSchedules,
  shouldRun,
} from "./schedule";
import type { JobSchedule } from "./schedule";

describe("Scheduled Checks (TASK-1302)", () => {
  describe("parseIntervalMs", () => {
    it("사람이 쓰는 단위를 모두 받는다", () => {
      expect(parseIntervalMs("30s", 1)).toBe(30_000);
      expect(parseIntervalMs("15m", 1)).toBe(900_000);
      expect(parseIntervalMs("1h", 1)).toBe(3_600_000);
      expect(parseIntervalMs("500ms", 1)).toBe(500);
      expect(parseIntervalMs("900000", 1)).toBe(900_000); // 단위 없으면 ms
      expect(parseIntervalMs("1.5h", 1)).toBe(5_400_000);
    });

    it("해석할 수 없거나 0 이하면 기본값 — 점검이 멈추거나 폭주하지 않게", () => {
      expect(parseIntervalMs(undefined, 777)).toBe(777);
      expect(parseIntervalMs("", 777)).toBe(777);
      expect(parseIntervalMs("   ", 777)).toBe(777);
      expect(parseIntervalMs("abc", 777)).toBe(777);
      expect(parseIntervalMs("0", 777)).toBe(777);
      expect(parseIntervalMs("-5m", 777)).toBe(777);
      expect(parseIntervalMs("15 minutes", 777)).toBe(777);
    });
  });

  describe("resolveSchedules", () => {
    it("미설정이면 기본 간격 — Health Check는 실호출이라 가장 드물게", () => {
      const schedules = resolveSchedules({});
      const byJob = Object.fromEntries(
        schedules.map((entry) => [entry.job, entry]),
      );
      expect(byJob["cost-verification"]).toMatchObject({
        intervalMs: DEFAULT_JOB_INTERVALS["cost-verification"],
        enabled: true,
        source: "default",
      });
      expect(byJob["health-check"].intervalMs).toBeGreaterThan(
        byJob["cost-verification"].intervalMs,
      );
    });

    it("환경변수로 간격을 조정한다", () => {
      const schedules = resolveSchedules({
        OPS_CHECK_COST_INTERVAL: "5m",
        OPS_CHECK_HEALTH_INTERVAL: "2h",
      });
      const byJob = Object.fromEntries(
        schedules.map((entry) => [entry.job, entry]),
      );
      expect(byJob["cost-verification"]).toMatchObject({
        intervalMs: 300_000,
        source: "env",
      });
      expect(byJob["health-check"].intervalMs).toBe(7_200_000);
      // 지정하지 않은 항목은 기본값 그대로
      expect(byJob["provider-validation"].source).toBe("default");
    });

    it("전체 끄기 — 개발·테스트에서 실호출 점검이 돌면 안 된다", () => {
      for (const value of ["off", "false", "0"]) {
        const schedules = resolveSchedules({ OPS_SCHEDULED_CHECKS: value });
        expect(schedules.every((entry) => entry.enabled)).toBe(false);
        expect(schedules.every((entry) => entry.source === "disabled")).toBe(
          true,
        );
      }
    });

    it("항목별로도 끌 수 있다", () => {
      const schedules = resolveSchedules({ OPS_CHECK_HEALTH_INTERVAL: "off" });
      const byJob = Object.fromEntries(
        schedules.map((entry) => [entry.job, entry]),
      );
      expect(byJob["health-check"].enabled).toBe(false);
      expect(byJob["cost-verification"].enabled).toBe(true);
    });

    it("선언된 점검 11종을 빠짐없이 돌려준다", () => {
      expect(resolveSchedules({}).map((entry) => entry.job).sort()).toEqual([
        "alert-archive",
        "backup",
        // 월말 예측 경보 (TASK-3201, CTO 정책 3201-④)
        "cost-forecast",
        "cost-verification",
        "governance-scan",
        "health-check",
        // 가격 변경 감지 (TASK-3201, CTO 정책 3201-①)
        "pricing-detect",
        "provider-smoke",
        "provider-validation",
        "remote-verify",
        "restore-verify",
      ]);
    });

    it("가격 감지는 기본으로 켜져 있고 6시간마다 돈다 (TASK-3201)", () => {
      // DB만 읽으므로 과금이 없다 — 꺼 둘 이유가 없고, 꺼져 있으면
      // 단가가 낡아도 아무도 모른다
      const byJob = Object.fromEntries(
        resolveSchedules({}).map((entry) => [entry.job, entry]),
      );
      expect(byJob["pricing-detect"].enabled).toBe(true);
      expect(byJob["pricing-detect"].intervalMs).toBe(6 * 60 * 60 * 1000);
      // 예측은 하루가 집계된 뒤 본다 — 시각 기반이다
      expect(byJob["cost-forecast"].dailyAtMinutes).toBe(6 * 60);
    });

    it("위반 스캔은 보관 정리보다 앞선 시각에 돈다 (TASK-2701)", () => {
      // 스캔이 남긴 기록을 보관이 곧바로 치우면 방금 만든 것을 못 보게 된다
      const byJob = Object.fromEntries(
        resolveSchedules({}).map((entry) => [entry.job, entry]),
      );
      expect(byJob["governance-scan"].dailyAtMinutes).toBeLessThan(
        byJob["alert-archive"].dailyAtMinutes!,
      );
    });

    it("과금되는 스모크는 기본이 꺼짐 — 모르는 사이 돈이 나가지 않게 (TASK-1601)", () => {
      const byJob = Object.fromEntries(
        resolveSchedules({}).map((entry) => [entry.job, entry]),
      );
      expect(byJob["provider-smoke"].enabled).toBe(false);
      // 명시적으로 켜야 돈다
      expect(
        resolveSchedules({ OPS_CHECK_SMOKE_AT: "05:00" }).find(
          (entry) => entry.job === "provider-smoke",
        )!.enabled,
      ).toBe(true);
      // 백업·복구 검증은 기본이 켜짐
      expect(byJob.backup.enabled).toBe(true);
      expect(byJob["restore-verify"].enabled).toBe(true);
    });

    it("시각 기반 점검의 기본 시각이 겹치지 않는다 (복구 검증 → 보관)", () => {
      const byJob = Object.fromEntries(
        resolveSchedules({}).map((entry) => [entry.job, entry]),
      );
      expect(byJob["restore-verify"].dailyAtMinutes).toBe(3 * 60 + 30);
      expect(byJob["alert-archive"].dailyAtMinutes).toBe(4 * 60);
    });

    it("백업은 1시간 간격으로 돈다 (CTO 결정 1701-①)", () => {
      // 하루 1회는 최대 24시간을 잃는다는 뜻이었다 — 시각이 아니라 간격이다
      const backup = resolveSchedules({}).find(
        (entry) => entry.job === "backup",
      )!;
      expect(backup.dailyAtMinutes).toBeNull();
      expect(backup.intervalMs).toBe(60 * 60 * 1000);
      expect(backup.env).toBe("OPS_CHECK_BACKUP_INTERVAL");

      expect(
        resolveSchedules({ OPS_CHECK_BACKUP_INTERVAL: "15m" }).find(
          (entry) => entry.job === "backup",
        )!.intervalMs,
      ).toBe(15 * 60 * 1000);
    });

    it("손실 한도 기본 목표는 백업 간격의 2배다", () => {
      // 간격만 바꾸고 목표를 그대로 두면, 백업이 오래 멈춰도 정상으로 보인다
      expect(defaultRpoTargetMs(60 * 60 * 1000)).toBe(2 * 60 * 60 * 1000);
      expect(defaultRpoTargetMs(15 * 60 * 1000)).toBe(30 * 60 * 1000);
    });

    it("보관은 시각 기반이다 (CTO 결정 1401-③ — 하루 1회 새벽)", () => {
      const archive = resolveSchedules({}).find(
        (entry) => entry.job === "alert-archive",
      )!;
      expect(archive.dailyAtMinutes).toBe(4 * 60); // 04:00 로컬 (결정 1501-①)
      expect(archive.enabled).toBe(true);

      const custom = resolveSchedules({ OPS_CHECK_ARCHIVE_AT: "02:30" }).find(
        (entry) => entry.job === "alert-archive",
      )!;
      expect(custom).toMatchObject({ dailyAtMinutes: 150, source: "env" });

      // 해석할 수 없는 시각은 기본값 — 엉뚱한 시각에 돌지 않게
      expect(
        resolveSchedules({ OPS_CHECK_ARCHIVE_AT: "25:99" }).find(
          (entry) => entry.job === "alert-archive",
        )!.dailyAtMinutes,
      ).toBe(4 * 60);
    });
  });

  describe("parseDailyAt", () => {
    it("HH:MM을 자정 이후 분으로", () => {
      expect(parseDailyAt("04:00")).toBe(240);
      expect(parseDailyAt("00:00")).toBe(0);
      expect(parseDailyAt("23:59")).toBe(1439);
      expect(parseDailyAt("4:05")).toBe(245);
    });

    it("해석할 수 없으면 null", () => {
      expect(parseDailyAt(undefined)).toBeNull();
      expect(parseDailyAt("24:00")).toBeNull();
      expect(parseDailyAt("04:60")).toBeNull();
      expect(parseDailyAt("새벽")).toBeNull();
      expect(parseDailyAt("0400")).toBeNull();
    });
  });

  describe("shouldRun", () => {
    const schedule: JobSchedule = {
      job: "cost-verification",
      intervalMs: 60_000,
      enabled: true,
      source: "default",
      env: "OPS_CHECK_COST_INTERVAL",
      dailyAtMinutes: null,
    };

    it("한 번도 안 돌았으면 돌린다 — 상태를 모르는 채로 두지 않는다", () => {
      expect(shouldRun(schedule, null, 1_000)).toBe(true);
    });

    it("간격이 지나야 돌린다", () => {
      expect(shouldRun(schedule, 1_000, 30_000)).toBe(false);
      expect(shouldRun(schedule, 1_000, 61_000)).toBe(true);
    });

    it("꺼져 있으면 돌지 않는다 (한 번도 안 돌았어도)", () => {
      expect(shouldRun({ ...schedule, enabled: false }, null, 1_000)).toBe(false);
    });
  });

  describe("shouldRun — 시각 기반 (CTO 결정 1401-③)", () => {
    const daily: JobSchedule = {
      job: "alert-archive",
      intervalMs: 24 * 60 * 60 * 1000,
      enabled: true,
      source: "default",
      env: "OPS_CHECK_ARCHIVE_AT",
      dailyAtMinutes: 4 * 60, // 04:00 (로컬)
    };
    /** 로컬 시간대 기준으로 만든다 (CTO 결정 1501-① — TZ를 따른다) */
    const local = (day: number, hour: number, minute = 0) =>
      new Date(2026, 6, day, hour, minute, 0, 0).getTime();

    it("그 시각 전에는 돌지 않는다 — 한 번도 안 돌았어도", () => {
      // "새벽에 돌리라"는 지시를 기동 시점에 어기지 않는다
      expect(shouldRun(daily, null, local(29, 3, 59))).toBe(false);
    });

    it("그 시각을 지나고 아직 안 돌았으면 돈다", () => {
      expect(shouldRun(daily, null, local(29, 4, 0))).toBe(true);
      expect(shouldRun(daily, local(28, 4, 5), local(29, 5, 0))).toBe(true);
    });

    it("오늘 이미 돌았으면 다시 돌지 않는다", () => {
      expect(shouldRun(daily, local(29, 4, 1), local(29, 23, 0))).toBe(false);
    });

    it("**로컬 시간대** 기준으로 판정한다 (CTO 결정 1501-①)", () => {
      // 로컬 03:59는 아직, 04:00은 실행 — UTC였다면 시간대에 따라 어긋난다
      expect(shouldRun(daily, null, local(29, 3, 59))).toBe(false);
      expect(shouldRun(daily, null, local(29, 4, 1))).toBe(true);
    });
  });

  describe("resolveGraceFactor (CTO 결정 1501-④)", () => {
    it("기본은 3배", () => {
      expect(resolveGraceFactor("cost-verification", {})).toBe(
        DEFAULT_GRACE_FACTOR,
      );
      expect(DEFAULT_GRACE_FACTOR).toBe(3);
    });

    it("전체 기본값을 바꿀 수 있다", () => {
      expect(
        resolveGraceFactor("cost-verification", {
          OPS_SCHEDULER_GRACE_FACTOR: "5",
        }),
      ).toBe(5);
    });

    it("Job별 값이 전체 기본값보다 우선한다", () => {
      const env = {
        OPS_SCHEDULER_GRACE_FACTOR: "5",
        OPS_SCHEDULER_GRACE_ALERT_ARCHIVE: "1.5",
      };
      expect(resolveGraceFactor("alert-archive", env)).toBe(1.5);
      expect(resolveGraceFactor("cost-verification", env)).toBe(5);
    });

    it("해석할 수 없는 값은 다음 순위로 내려간다", () => {
      expect(
        resolveGraceFactor("alert-archive", {
          OPS_SCHEDULER_GRACE_ALERT_ARCHIVE: "abc",
          OPS_SCHEDULER_GRACE_FACTOR: "4",
        }),
      ).toBe(4);
      expect(
        resolveGraceFactor("alert-archive", {
          OPS_SCHEDULER_GRACE_ALERT_ARCHIVE: "0",
        }),
      ).toBe(DEFAULT_GRACE_FACTOR);
    });
  });

  describe("isSchedulerStopped (CTO 결정 1401-①)", () => {
    const schedule: JobSchedule = {
      job: "cost-verification",
      intervalMs: 60_000,
      enabled: true,
      source: "default",
      env: "OPS_CHECK_COST_INTERVAL",
      dailyAtMinutes: null,
    };
    const now = 1_000_000;

    it("간격의 3배를 넘겨야 멈춘 것으로 본다 — 한 번 늦었다고 경보하지 않는다", () => {
      expect(isSchedulerStopped(schedule, now - 120_000, now)).toBe(false);
      expect(isSchedulerStopped(schedule, now - 180_000, now)).toBe(false);
      expect(isSchedulerStopped(schedule, now - 200_000, now)).toBe(true);
    });

    it("한 번도 안 돌았으면 기동 시점부터 센다 — 방금 뜬 서버를 장애라 하지 않는다", () => {
      expect(isSchedulerStopped(schedule, null, now, { startedAt: now - 1_000 })).toBe(
        false,
      );
      expect(
        isSchedulerStopped(schedule, null, now, { startedAt: now - 500_000 }),
      ).toBe(true);
    });

    it("꺼 둔 점검은 멈춘 것이 아니다", () => {
      expect(
        isSchedulerStopped({ ...schedule, enabled: false }, now - 999_999, now),
      ).toBe(false);
    });

    it("여유 배수를 조정할 수 있다", () => {
      expect(
        isSchedulerStopped(schedule, now - 120_000, now, { graceFactor: 1 }),
      ).toBe(true);
    });
  });
});

describe("원격 사본 대조 예약 (TASK-2101, CTO 결정 2001-②)", () => {
  const find = (env: Record<string, string | undefined>) =>
    resolveSchedules(env).find((entry) => entry.job === "remote-verify")!;

  it("운영에서는 주 1회로 켜진다", () => {
    const schedule = find({ NODE_ENV: "production" });
    expect(schedule.enabled).toBe(true);
    expect(schedule.intervalMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("운영이 아니면 꺼진다 — 개발이 전송 비용을 낼 이유가 없다", () => {
    expect(find({}).enabled).toBe(false);
    expect(find({ NODE_ENV: "development" }).source).toBe("disabled");
  });

  it("운영이 아니어도 명시하면 켤 수 있다 — 스테이징에서 한 번 돌려 볼 길", () => {
    const schedule = find({ OPS_CHECK_REMOTE_VERIFY_INTERVAL: "1d" });
    expect(schedule.enabled).toBe(true);
    expect(schedule.intervalMs).toBe(24 * 60 * 60 * 1000);
    expect(schedule.source).toBe("env");
  });

  it("운영에서도 off로 끌 수 있다", () => {
    expect(
      find({ NODE_ENV: "production", OPS_CHECK_REMOTE_VERIFY_INTERVAL: "off" })
        .enabled,
    ).toBe(false);
  });

  it("주 단위를 일(day)로 적을 수 있다 — 168h로 적게 만들지 않는다", () => {
    expect(parseIntervalMs("7d", 0)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseIntervalMs("1d", 0)).toBe(24 * 60 * 60 * 1000);
  });

  it("PRODUCTION_ONLY_JOBS에 들어 있다", () => {
    expect(PRODUCTION_ONLY_JOBS).toContain("remote-verify");
  });
});
