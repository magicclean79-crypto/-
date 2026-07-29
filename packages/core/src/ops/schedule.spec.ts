import {
  DEFAULT_GRACE_FACTOR,
  DEFAULT_JOB_INTERVALS,
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

    it("선언된 점검 7종을 빠짐없이 돌려준다", () => {
      expect(resolveSchedules({}).map((entry) => entry.job).sort()).toEqual([
        "alert-archive",
        "backup",
        "cost-verification",
        "health-check",
        "provider-smoke",
        "provider-validation",
        "restore-verify",
      ]);
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

    it("점검별 기본 시각이 겹치지 않는다 (백업 → 복구 검증 → 보관)", () => {
      const byJob = Object.fromEntries(
        resolveSchedules({}).map((entry) => [entry.job, entry]),
      );
      expect(byJob.backup.dailyAtMinutes).toBe(3 * 60);
      expect(byJob["restore-verify"].dailyAtMinutes).toBe(3 * 60 + 30);
      expect(byJob["alert-archive"].dailyAtMinutes).toBe(4 * 60);
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
