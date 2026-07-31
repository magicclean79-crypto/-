import {
  DEFAULT_PROMOTION_AFTER_MS,
  PROMOTION_ENABLED_KEY,
  PROMOTION_SETTING_KEY,
  judgeIncidentPromotion,
  resolvePromotionSettings,
  validateConfirmation,
  validateDismissal,
} from "./incident-promotion";
import type { PromotableAlert } from "./incident-promotion";

/**
 * 경보 → 장애 초안 승격 검증. (TASK-3901 — CTO 정책 3901-⑤)
 *
 * 지키는 것: **초안은 장애가 아니다**, **CRITICAL만·오래 살아 있어야**,
 * **같은 경보로 두 번 만들지 않는다**, **기각도 사유와 함께 남는다**.
 */
describe("경보 → 장애 초안 승격 (TASK-3901)", () => {
  const now = Date.parse("2026-07-31T12:00:00Z");
  const alert = (overrides: Partial<PromotableAlert> = {}): PromotableAlert => ({
    key: "provider-failure:openai",
    kind: "provider-failure",
    level: "critical",
    status: "ACTIVE",
    title: "openai 호출 실패율 급증",
    message: "최근 60분 실패율 82%",
    firstRaisedAt: now - 45 * 60 * 1000,
    ...overrides,
  });

  const run = (overrides: Partial<Parameters<typeof judgeIncidentPromotion>[0]> = {}) =>
    judgeIncidentPromotion({
      alerts: [alert()],
      existingSourceKeys: [],
      afterMs: DEFAULT_PROMOTION_AFTER_MS,
      now,
      enabled: true,
      ...overrides,
    });

  it("오래 살아 있은 CRITICAL 경보를 초안으로 만든다", () => {
    const report = run();
    expect(report.drafts).toHaveLength(1);
    expect(report.drafts[0].sourceAlertKey).toBe("provider-failure:openai");
    expect(report.drafts[0].component).toBe("llm");
    expect(report.drafts[0].severity).toBe("CRITICAL");
    // 초안은 질문이지 선언이 아니다
    expect(report.drafts[0].detail).toContain("장애가 아니라 질문");
    expect(report.detail).toContain("사람의 확인이 필요합니다");
  });

  it("기본은 꺼짐이다 — 장애 목록에 자동으로 무언가를 넣는 기능은 켜기로 결정해야 한다", () => {
    const settings = resolvePromotionSettings({});
    expect(settings.enabled).toBe(false);
    const report = run({ enabled: false });
    expect(report.drafts).toEqual([]);
    expect(report.detail).toContain("장애는 사람이 엽니다");
  });

  it("warning으로는 초안을 만들지 않는다 — 목록이 초안으로 뒤덮이면 아무도 안 본다", () => {
    expect(run({ alerts: [alert({ level: "warning" })] }).drafts).toEqual([]);
  });

  it("잠깐 뜬 경보는 장애가 아니다", () => {
    const report = run({
      alerts: [alert({ firstRaisedAt: now - 5 * 60 * 1000 })],
    });
    expect(report.drafts).toEqual([]);
    expect(report.waiting).toBe(1);
    expect(report.detail).toContain("아직 이른 경보 1건");
  });

  it("같은 경보로 두 번 만들지 않는다 — 경보는 쿨다운마다 다시 알린다", () => {
    const report = run({ existingSourceKeys: ["provider-failure:openai"] });
    expect(report.drafts).toEqual([]);
    expect(report.skipped).toBe(1);
  });

  it("해소된 경보도 승격한다 — 새벽에 40분 살다 저절로 풀린 것이 우리가 놓치던 것이다", () => {
    const report = run({ alerts: [alert({ status: "RESOLVED" })] });
    expect(report.drafts).toHaveLength(1);
  });

  it("모르는 경보 종류는 구성 요소를 지어내지 않는다", () => {
    const report = run({ alerts: [alert({ kind: "무언가-새로운" })] });
    expect(report.drafts[0].component).toBe("other");
  });

  it("시작 시각은 경보를 처음 본 때다 — 승격한 때가 아니다", () => {
    const report = run();
    expect(report.drafts[0].startedAt.getTime()).toBe(now - 45 * 60 * 1000);
  });

  describe("설정", () => {
    it("임계를 분 단위로 받는다", () => {
      const settings = resolvePromotionSettings({
        [PROMOTION_ENABLED_KEY]: "true",
        [PROMOTION_SETTING_KEY]: "60",
      });
      expect(settings.enabled).toBe(true);
      expect(settings.afterMs).toBe(60 * 60 * 1000);
    });

    it("너무 짧거나 긴 임계는 받지 않는다", () => {
      const short = resolvePromotionSettings({ [PROMOTION_SETTING_KEY]: "1" });
      expect(short.afterMs).toBe(DEFAULT_PROMOTION_AFTER_MS);
      expect(short.rejected[0].reason).toContain("5분보다 짧으면");

      const long = resolvePromotionSettings({ [PROMOTION_SETTING_KEY]: "5000" });
      expect(long.rejected).toHaveLength(1);
    });
  });

  describe("확인·기각", () => {
    it("사유 없이 기각하지 않는다 — '아무것도 아니었다'도 다음에 쓰인다", () => {
      expect(validateDismissal({ status: "DRAFT", reason: "" })).toEqual({
        ok: false,
        reason: expect.stringContaining("기각 사유를 적어 주세요"),
      });
    });

    it("확인된 장애는 기각이 아니라 복구로 닫는다", () => {
      expect(
        validateDismissal({ status: "CONFIRMED", reason: "아무 일도 없었음" }),
      ).toEqual({ ok: false, reason: expect.stringContaining("초안만 기각") });
    });

    it("사유가 있으면 기각할 수 있다", () => {
      expect(
        validateDismissal({ status: "DRAFT", reason: "Provider 측 일시 점검 공지 확인" }),
      ).toEqual({ ok: true });
    });

    it("경보 제목 그대로는 장애 설명이 아니다", () => {
      expect(validateConfirmation({ status: "DRAFT", summary: "경보" }).ok).toBe(false);
      expect(
        validateConfirmation({
          status: "DRAFT",
          summary: "OpenAI 장애로 상세페이지 생성이 40분간 멈춤",
        }),
      ).toEqual({ ok: true });
    });
  });
});
