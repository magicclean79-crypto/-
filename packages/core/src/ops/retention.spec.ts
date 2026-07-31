import {
  describeSweep,
  resolveRetention,
  retentionSettingKey,
  validateRetention,
} from "./retention";

/**
 * 보존 정책 검증. (TASK-3901 — CTO 정책 3901-③)
 *
 * 지키는 것: **감사 기록을 짧게 줄이는 것은 감사를 끄는 것이다**,
 * **아무것도 안 지웠어도 그 사실을 적는다**.
 */
describe("운영 기록 보존 정책 (TASK-3901)", () => {
  describe("바닥", () => {
    it("감사 기록을 반년보다 짧게 둘 수 없다 — 그건 보존 정책이 아니라 감사를 끄는 것이다", () => {
      const result = validateRetention(retentionSettingKey("ops-audit"), "30");
      expect(result).toEqual({
        ok: false,
        reason: expect.stringContaining("감사를 끄는 것"),
      });
    });

    it("이벤트는 한 분기보다 길어야 한다", () => {
      expect(validateRetention(retentionSettingKey("ops-events"), "30").ok).toBe(false);
      expect(validateRetention(retentionSettingKey("ops-events"), "90").ok).toBe(true);
    });

    it("상한도 둔다 — 무한은 정책이 아니다", () => {
      expect(validateRetention(retentionSettingKey("ops-audit"), "99999").ok).toBe(false);
    });

    it("정수가 아니면 받지 않는다", () => {
      expect(validateRetention(retentionSettingKey("ops-audit"), "365.5").ok).toBe(false);
    });

    it("대상이 아닌 것은 받지 않는다", () => {
      expect(validateRetention("retention.executions.days", "30").ok).toBe(false);
    });
  });

  describe("해석", () => {
    it("기본은 감사가 이벤트보다 길다 — 사고는 몇 달 뒤에 드러난다", () => {
      const { policies } = resolveRetention({});
      const audit = policies.find((row) => row.target === "ops-audit");
      const events = policies.find((row) => row.target === "ops-events");
      expect(audit?.days).toBe(365);
      expect(events?.days).toBe(180);
      expect(audit!.days).toBeGreaterThan(events!.days);
    });

    it("운영자 값이 반영되고 기본값 여부가 남는다", () => {
      const { policies } = resolveRetention({
        [retentionSettingKey("ops-audit")]: "730",
      });
      const audit = policies.find((row) => row.target === "ops-audit");
      expect(audit?.days).toBe(730);
      expect(audit?.isDefault).toBe(false);
    });

    it("바닥 아래 값은 기본값으로 두고 사유를 남긴다 — 조용히 버리지 않는다", () => {
      const { policies, rejected } = resolveRetention({
        [retentionSettingKey("ops-audit")]: "10",
      });
      expect(policies.find((row) => row.target === "ops-audit")?.days).toBe(365);
      expect(rejected).toHaveLength(1);
    });
  });

  describe("정리 결과", () => {
    it("아무것도 안 지웠어도 그 사실을 적는다 — 없어진 기록은 스스로 말하지 못한다", () => {
      const line = describeSweep([
        {
          target: "ops-audit",
          title: "운영 감사 기록",
          days: 365,
          deleted: 0,
          cutoff: "2025-07-31T00:00:00.000Z",
        },
      ]);
      expect(line).toContain("보존 기간을 넘긴 기록이 없습니다");
      expect(line).toContain("0건");
    });

    it("지운 건수를 대상별로 적는다", () => {
      const line = describeSweep([
        {
          target: "ops-audit",
          title: "운영 감사 기록",
          days: 365,
          deleted: 12,
          cutoff: "2025-07-31T00:00:00.000Z",
        },
        {
          target: "ops-events",
          title: "운영 이벤트",
          days: 180,
          deleted: 3,
          cutoff: "2026-02-01T00:00:00.000Z",
        },
      ]);
      expect(line).toContain("15건을 정리했습니다");
      expect(line).toContain("운영 감사 기록 12건");
    });
  });
});
