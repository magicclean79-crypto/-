import {
  describeThreshold,
  judgeAgainstThreshold,
  resolveKpiThresholds,
  thresholdSettingKey,
  validateThreshold,
} from "./kpi-thresholds";

/**
 * KPI 임계값 운영 설정 검증. (TASK-3901 — CTO 정책 3901-②)
 *
 * 이 기능의 위험은 하나다: **임계값을 올리면 아무것도 나아지지 않았는데
 * 화면이 초록이 된다.** 그래서 여기서 지키는 것은 "설정이 되는가"가 아니라
 * **느슨하게 바꾼 것이 드러나는가**와 **범위 밖 값이 막히는가**다.
 */
describe("KPI 임계값 (TASK-3901)", () => {
  describe("느슨하게 바꾼 것을 드러낸다", () => {
    it("작을수록 좋은 지표는 올리면 느슨한 것이다", () => {
      const result = resolveKpiThresholds({
        [thresholdSettingKey("mttr", "watch")]: "600",
      });
      expect(result.thresholds.mttr.relaxed).toBe(true);
      expect(result.relaxed.map((row) => row.id)).toEqual(["mttr"]);
      expect(describeThreshold(result.thresholds.mttr)).toContain(
        "상태가 좋아진 것이 아닙니다",
      );
    });

    it("작을수록 좋은 지표는 내리면 엄격한 것이다", () => {
      const result = resolveKpiThresholds({
        [thresholdSettingKey("mttr", "good")]: "30",
      });
      expect(result.thresholds.mttr.relaxed).toBe(false);
      expect(describeThreshold(result.thresholds.mttr)).toContain("엄격합니다");
    });

    it("클수록 좋은 지표는 내리면 느슨한 것이다", () => {
      const result = resolveKpiThresholds({
        [thresholdSettingKey("ci", "good")]: "60",
      });
      expect(result.thresholds.ci.relaxed).toBe(true);
    });

    it("good은 그대로 두고 watch만 늘려도 느슨한 것이다 — 그 방식으로도 빨강을 지울 수 있다", () => {
      const result = resolveKpiThresholds({
        [thresholdSettingKey("follow-up", "watch")]: "30",
      });
      expect(result.thresholds["follow-up"].relaxed).toBe(true);
    });

    it("기본값이면 아무 말도 하지 않는다 — 모든 카드에 붙는 문구는 배경이 된다", () => {
      const result = resolveKpiThresholds({});
      expect(result.adjusted).toEqual([]);
      expect(describeThreshold(result.thresholds.mttr)).toBeNull();
    });
  });

  describe("범위", () => {
    it("범위 밖 값은 임계값이 아니라 우회다", () => {
      const result = validateThreshold(thresholdSettingKey("mttr", "watch"), "43200");
      expect(result).toEqual({
        ok: false,
        reason: expect.stringContaining("임계값을 없앤 것"),
      });
    });

    it("너무 작은 값도 막는다", () => {
      expect(validateThreshold(thresholdSettingKey("ci", "good"), "10").ok).toBe(false);
    });

    it("임계값을 둘 수 없는 지표는 받지 않는다", () => {
      expect(
        validateThreshold("kpi.threshold.activation.good", "1"),
      ).toEqual({ ok: false, reason: expect.stringContaining("임계값을 둘 수 없는") });
    });

    it("숫자가 아니면 받지 않는다", () => {
      expect(validateThreshold(thresholdSettingKey("mttr", "good"), "빠르게").ok).toBe(
        false,
      );
    });

    it("지우는 것은 기본값으로 되돌리는 것이다", () => {
      expect(validateThreshold(thresholdSettingKey("mttr", "good"), null)).toEqual({
        ok: true,
      });
    });

    it("잘못된 값은 조용히 버리지 않고 사유를 남긴다", () => {
      const result = resolveKpiThresholds({
        [thresholdSettingKey("mttr", "watch")]: "99999",
      });
      // 판정은 기본값으로 계속된다 — 멈추는 것보다 낫다
      expect(result.thresholds.mttr.value.watch).toBe(240);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].key).toContain("mttr");
    });
  });

  describe("판정", () => {
    it("작을수록 좋은 지표", () => {
      const { thresholds } = resolveKpiThresholds({});
      expect(judgeAgainstThreshold(30, thresholds.mttr)).toBe("good");
      expect(judgeAgainstThreshold(200, thresholds.mttr)).toBe("watch");
      expect(judgeAgainstThreshold(300, thresholds.mttr)).toBe("bad");
    });

    it("클수록 좋은 지표", () => {
      const { thresholds } = resolveKpiThresholds({});
      expect(judgeAgainstThreshold(99, thresholds.ci)).toBe("good");
      expect(judgeAgainstThreshold(85, thresholds.ci)).toBe("watch");
      expect(judgeAgainstThreshold(50, thresholds.ci)).toBe("bad");
    });

    it("스모크는 100%가 아니면 정상이 아니다 — 셋 다 통과해야 한다 (정책 3701-②)", () => {
      const { thresholds } = resolveKpiThresholds({});
      expect(judgeAgainstThreshold(99, thresholds.smoke)).toBe("watch");
      expect(judgeAgainstThreshold(100, thresholds.smoke)).toBe("good");
    });

    it("조정된 임계값이 판정에 실제로 쓰인다", () => {
      const { thresholds } = resolveKpiThresholds({
        [thresholdSettingKey("mttr", "good")]: "600",
      });
      expect(judgeAgainstThreshold(300, thresholds.mttr)).toBe("good");
    });
  });
});
