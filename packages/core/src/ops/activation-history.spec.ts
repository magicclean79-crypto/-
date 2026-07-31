import {
  activationSignature,
  formatDuration,
  shouldRecordActivation,
  summarizeActivationHistory,
} from "./activation-history";
import type { ActivationHistoryEntry } from "./activation-history";
import type { ActivationConditionId, ActivationReport } from "./activation";

/**
 * 활성화 이력 검증. (TASK-3701 — CTO 정책 3701-①)
 *
 * 여기서 지키는 것은 셋이다: **변화만 남는가**, **되돌아간 것을 말하는가**,
 * 그리고 **안 본 구간을 '유지됐다'로 세지 않는가**.
 */
describe("활성화 이력 (TASK-3701)", () => {
  const report = (
    activated: boolean,
    met: ActivationConditionId[],
  ): ActivationReport => ({
    activated,
    applicable: true,
    environment: "production",
    detail: "",
    conditions: (["credentials", "network", "cutover"] as const).map((id) => ({
      id,
      title: id,
      met: met.includes(id),
      detail: "",
      next: "",
    })),
  });

  const entry = (
    overrides: Partial<ActivationHistoryEntry> & { recordedAt: Date },
  ): ActivationHistoryEntry => ({
    lastSeenAt: overrides.recordedAt,
    observations: 1,
    activated: false,
    signature: "off:",
    met: [],
    environment: "production",
    detail: "",
    ...overrides,
  });

  describe("지문", () => {
    it("충족된 조건 집합이 같으면 같은 지문이다 — 순서가 달라도", () => {
      expect(activationSignature(report(false, ["network", "credentials"]))).toBe(
        activationSignature(report(false, ["credentials", "network"])),
      );
    });

    it("조건이 하나 늘면 다른 지문이다", () => {
      expect(activationSignature(report(false, ["credentials"]))).not.toBe(
        activationSignature(report(false, ["credentials", "network"])),
      );
    });

    it("같은 상태를 다시 보면 새 줄을 만들지 않는다 — 같은 문장 수천 줄에서는 변화가 안 보인다", () => {
      const first = activationSignature(report(false, ["credentials"]));
      expect(shouldRecordActivation(first, report(false, ["credentials"]))).toBe(false);
      expect(shouldRecordActivation(first, report(false, ["credentials", "network"]))).toBe(
        true,
      );
    });

    it("기록이 하나도 없으면 첫 관측은 반드시 남는다", () => {
      expect(shouldRecordActivation(null, report(false, []))).toBe(true);
    });
  });

  describe("타임라인", () => {
    it("이력이 없으면 activated는 null이다 — '활성화 안 됨'이 아니라 '모른다'", () => {
      const summary = summarizeActivationHistory([]);
      expect(summary.activated).toBeNull();
      expect(summary.detail).toContain("이력이 없는 것을");
    });

    it("각 구간이 얼마나 이어졌는지 센다", () => {
      const now = new Date("2026-07-30T12:00:00Z");
      const summary = summarizeActivationHistory(
        [
          entry({ recordedAt: new Date("2026-07-30T00:00:00Z") }),
          entry({
            recordedAt: new Date("2026-07-30T06:00:00Z"),
            met: ["credentials"],
            lastSeenAt: new Date("2026-07-30T11:00:00Z"),
          }),
        ],
        now,
      );
      expect(summary.timeline[0].heldMs).toBe(6 * 60 * 60 * 1000);
      expect(summary.timeline[0].ongoing).toBe(false);
      expect(summary.timeline[1].heldMs).toBe(6 * 60 * 60 * 1000);
      expect(summary.timeline[1].ongoing).toBe(true);
      expect(summary.changes).toBe(1);
    });

    it("직전 대비 무엇이 늘고 무엇이 빠졌는지 말한다", () => {
      const summary = summarizeActivationHistory(
        [
          entry({
            recordedAt: new Date("2026-07-01T00:00:00Z"),
            met: ["credentials", "network"],
          }),
          entry({ recordedAt: new Date("2026-07-02T00:00:00Z"), met: ["network"] }),
        ],
        new Date("2026-07-03T00:00:00Z"),
      );
      expect(summary.timeline[1].lost).toEqual(["credentials"]);
      expect(summary.timeline[1].gained).toEqual([]);
      expect(summary.regressions).toBe(1);
      expect(summary.detail).toContain("되돌아간 적 1회");
    });

    it("마지막 확인 이후 구간은 '유지됐다'로 세지 않는다 — 조용한 것과 안 본 것은 다르다", () => {
      const summary = summarizeActivationHistory(
        [
          entry({
            recordedAt: new Date("2026-07-01T00:00:00Z"),
            lastSeenAt: new Date("2026-07-01T01:00:00Z"),
          }),
        ],
        new Date("2026-07-05T00:00:00Z"),
      );
      expect(summary.timeline[0].unobservedMs).toBe(95 * 60 * 60 * 1000);
      expect(summary.detail).toContain("아무도");
      expect(summary.detail).toContain("'모른다'");
    });

    it("처음 활성화된 시각을 기억한다", () => {
      const summary = summarizeActivationHistory(
        [
          entry({ recordedAt: new Date("2026-07-01T00:00:00Z") }),
          entry({
            recordedAt: new Date("2026-07-02T00:00:00Z"),
            activated: true,
            met: ["credentials", "network", "cutover"],
          }),
        ],
        new Date("2026-07-03T00:00:00Z"),
      );
      expect(summary.firstActivatedAt).toEqual(new Date("2026-07-02T00:00:00Z"));
      expect(summary.activated).toBe(true);
    });

    it("시간 순서가 뒤섞여 들어와도 정렬해서 읽는다", () => {
      const summary = summarizeActivationHistory(
        [
          entry({ recordedAt: new Date("2026-07-02T00:00:00Z"), met: ["network"] }),
          entry({ recordedAt: new Date("2026-07-01T00:00:00Z") }),
        ],
        new Date("2026-07-03T00:00:00Z"),
      );
      expect(summary.timeline[0].recordedAt).toEqual(new Date("2026-07-01T00:00:00Z"));
      expect(summary.timeline[1].gained).toEqual(["network"]);
    });
  });

  describe("기간 표기", () => {
    it("단위를 항상 붙인다", () => {
      expect(formatDuration(0)).toBe("0분");
      expect(formatDuration(90 * 60 * 1000)).toBe("1시간 30분");
      expect(formatDuration(50 * 60 * 60 * 1000)).toBe("2일 2시간");
      expect(formatDuration(-1)).toBe("0분");
    });
  });
});
