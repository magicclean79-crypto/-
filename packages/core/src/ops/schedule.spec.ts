import {
  DEFAULT_JOB_INTERVALS,
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

    it("선언된 점검 3종을 빠짐없이 돌려준다", () => {
      expect(resolveSchedules({}).map((entry) => entry.job).sort()).toEqual([
        "cost-verification",
        "health-check",
        "provider-validation",
      ]);
    });
  });

  describe("shouldRun", () => {
    const schedule: JobSchedule = {
      job: "cost-verification",
      intervalMs: 60_000,
      enabled: true,
      source: "default",
      env: "OPS_CHECK_COST_INTERVAL",
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
});
