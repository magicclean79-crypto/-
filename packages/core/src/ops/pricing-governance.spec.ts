import { DEFAULT_LLM_PRICING } from "../execution/execution";
import { DEFAULT_OCR_PRICING } from "../ocr/ocr-pricing";
import {
  EFFECTIVE_FROM_MAX_DAYS,
  PRICING_ORIGINS,
  isAutoOrigin,
  judgeScheduleCancel,
  judgeSecondApproval,
  requiresSecondApproval,
  PRICING_STAGES,
  PRICING_TARGETS,
  canAdvancePricing,
  describeEffectiveFrom,
  describePricingProposal,
  describeSelfApproval,
  judgePricingTransition,
  judgeSelfApproval,
  nextPricingChangeAt,
  nextPricingStages,
  resolvePricingAt,
  startStage,
  validateEffectiveFrom,
  validateProposedPrice,
} from "./pricing-governance";
import type { AppliedPricing } from "./pricing-governance";

const defaults = { llm: DEFAULT_LLM_PRICING, ocr: DEFAULT_OCR_PRICING };
const at = (iso: string) => new Date(iso);

describe("가격표 거버넌스 (TASK-3101, CTO 정책 3101-①②)", () => {
  it("대상과 단계를 값으로 고정한다", () => {
    expect([...PRICING_TARGETS]).toEqual(["llm", "ocr"]);
    expect([...PRICING_STAGES]).toEqual([
      "DETECTED",
      "DRAFT",
      "REVIEWED",
      "APPROVED",
      // 2차 승인·예약 취소 (TASK-3301, CTO 정책 3301-②③)
      "CONFIRMED",
      "APPLIED",
      "REJECTED",
      "CANCELLED",
    ]);
  });

  describe("단계를 건너뛸 수 없다 (정책 3101-①)", () => {
    it("검토 없이 승인할 수 없다", () => {
      expect(canAdvancePricing("DRAFT", "APPROVED")).toBe(false);
      expect(judgePricingTransition("DRAFT", "APPROVED").reason).toContain(
        "검토 → 승인 → 적용 순서를 건너뛸 수 없습니다",
      );
    });

    it("승인 없이 적용할 수 없다", () => {
      expect(canAdvancePricing("DRAFT", "APPLIED")).toBe(false);
      expect(canAdvancePricing("REVIEWED", "APPLIED")).toBe(false);
      expect(canAdvancePricing("APPROVED", "APPLIED")).toBe(true);
    });

    it("정해진 순서는 그대로 통과한다", () => {
      expect(nextPricingStages("DRAFT")).toEqual(["REVIEWED", "REJECTED"]);
      expect(nextPricingStages("REVIEWED")).toEqual(["APPROVED", "REJECTED"]);
      // 2차 승인이 선택지로 늘었다 (TASK-3301, CTO 정책 3301-②)
      expect(nextPricingStages("APPROVED")).toEqual([
        "CONFIRMED",
        "APPLIED",
        "REJECTED",
      ]);
    });

    it("적용 전 어느 단계에서도 반려할 수 있다 — 검토가 통과를 뜻하지 않는다", () => {
      for (const stage of ["DRAFT", "REVIEWED", "APPROVED"] as const) {
        expect(canAdvancePricing(stage, "REJECTED")).toBe(true);
      }
    });

    it("적용된 제안은 되돌릴 수 없다 — 새 제안을 내야 한다", () => {
      // 갈 수 있는 곳은 예약 취소뿐이다 (TASK-3301, CTO 정책 3301-③)
      expect(nextPricingStages("APPLIED")).toEqual(["CANCELLED"]);
      const judged = judgePricingTransition("APPLIED", "REJECTED");
      expect(judged.ok).toBe(false);
      expect(judged.reason).toContain("적용 기록은 바꾸지 않습니다");
    });

    it("반려된 제안도 되살리지 않는다", () => {
      expect(judgePricingTransition("REJECTED", "APPROVED").reason).toContain(
        "새 제안을 내세요",
      );
    });

    it("거꾸로 가는 전이도 막고 이유를 말한다", () => {
      const judged = judgePricingTransition("APPROVED", "DRAFT");
      expect(judged.ok).toBe(false);
      expect(judged.reason).toContain("가능: CONFIRMED, APPLIED, REJECTED");
    });
  });

  describe("제안된 단가 형식", () => {
    it("LLM은 입력·출력 단가가 둘 다 필요하다", () => {
      expect(
        validateProposedPrice("llm", { inputPerMillion: 1, outputPerMillion: 2 }),
      ).toBeNull();
      expect(validateProposedPrice("llm", { inputPerMillion: 1 })).toContain(
        "inputPerMillion·outputPerMillion",
      );
    });

    it("OCR은 단위 단가가 필요하다", () => {
      expect(validateProposedPrice("ocr", { perUnitUsd: 0.0015 })).toBeNull();
      expect(validateProposedPrice("ocr", { perUnitUsd: "싸다" })).toContain(
        "perUnitUsd",
      );
    });

    it("0은 허용한다 — 무료 모델·엔진이 실제로 있다", () => {
      expect(validateProposedPrice("ocr", { perUnitUsd: 0 })).toBeNull();
      expect(
        validateProposedPrice("llm", { inputPerMillion: 0, outputPerMillion: 0 }),
      ).toBeNull();
    });

    it("음수는 거부한다 — 지출을 줄여 예산 상한을 무력화한다", () => {
      expect(validateProposedPrice("ocr", { perUnitUsd: -1 })).not.toBeNull();
      expect(
        validateProposedPrice("llm", {
          inputPerMillion: -1,
          outputPerMillion: 1,
        }),
      ).not.toBeNull();
    });

    it("객체가 아니면 거부한다", () => {
      expect(validateProposedPrice("llm", null)).toContain("객체여야");
      expect(validateProposedPrice("llm", 3)).toContain("객체여야");
    });
  });

  describe("교차 확인 (TASK-3201, CTO 정책 3201-②)", () => {
    const same = { proposedBy: "admin@acos.local", approvedBy: "admin@acos.local" };

    it("운영에서는 자기 승인을 차단한다", () => {
      const judged = judgeSelfApproval({ ...same, environment: "production" });
      expect(judged.allowed).toBe(false);
      expect(judged.level).toBe("blocked");
      expect(judged.message).toContain("운영에서는 자기 승인을 허용하지 않습니다");
      // 무엇을 하면 되는지 말한다 — 막기만 하면 사람은 코드를 고친다
      expect(judged.message).toContain("다른 ADMIN 계정으로 승인");
    });

    it("개발에서는 허용하되 사실을 남긴다", () => {
      // 개발에서 절차가 막히면 사람은 코드를 직접 고쳐 우회하고, 그러면
      // 이력이 아예 없어진다 (결정 2601-① 교훈)
      const judged = judgeSelfApproval({ ...same, environment: "development" });
      expect(judged.allowed).toBe(true);
      expect(judged.level).toBe("warning");
      expect(judged.message).toContain("교차 확인은 이뤄지지 않았습니다");
      // 운영에서는 다르다는 사실도 함께 말한다
      expect(judged.message).toContain("운영에서는 차단됩니다");
    });

    it("환경 미설정은 운영이 아니다 — 개발로 본다", () => {
      expect(judgeSelfApproval({ ...same, environment: undefined }).allowed).toBe(
        true,
      );
    });

    it("다르면 어느 환경에서도 통과한다", () => {
      for (const environment of ["production", "development"]) {
        const judged = judgeSelfApproval({
          proposedBy: "a@x",
          approvedBy: "b@x",
          environment,
        });
        expect(judged.allowed).toBe(true);
        expect(judged.message).toBeNull();
      }
    });

    it("아직 승인되지 않았으면 판정할 것이 없다", () => {
      expect(
        judgeSelfApproval({
          proposedBy: "a@x",
          approvedBy: null,
          environment: "production",
        }).message,
      ).toBeNull();
    });

    it("감지된 제안은 제안자가 사람이 아니므로 통과한다 — 다만 사실을 밝힌다", () => {
      // 시스템이 제안한 것을 사람이 승인하면 "두 사람이 봤다"가 아니다
      const judged = judgeSelfApproval({
        proposedBy: null,
        approvedBy: "admin@acos.local",
        environment: "production",
      });
      expect(judged.allowed).toBe(true);
      expect(
        describeSelfApproval({
          origin: "detected",
          proposedBy: null,
          approvedBy: "admin@acos.local",
          environment: "production",
        }),
      ).toContain("사람의 확인은 1회입니다");
    });
  });

  describe("감지 → 승인 → 적용 (TASK-3201, CTO 정책 3201-①)", () => {
    it("출처를 값으로 고정한다", () => {
      // 외부 공지 출처가 늘었다 (TASK-3301, CTO 정책 3301-①)
      expect([...PRICING_ORIGINS]).toEqual(["manual", "detected", "published"]);
      expect(startStage("detected")).toBe("DETECTED");
      expect(startStage("manual")).toBe("DRAFT");
    });

    it("감지된 제안은 승인으로 바로 간다 — 감지가 검토를 대신한다", () => {
      expect(nextPricingStages("DETECTED")).toEqual(["APPROVED", "REJECTED"]);
    });

    it("감지만으로 적용되지 않는다 — 사람의 승인이 반드시 있다", () => {
      // 자동 적용을 허용하면 Provider 쪽 이상이나 우리 계산 오류가 곧바로
      // 돈의 기준을 바꾼다
      const judged = judgePricingTransition("DETECTED", "APPLIED");
      expect(judged.ok).toBe(false);
      expect(judged.reason).toContain("감지 → 승인 → 적용");
    });

    it("감지된 제안도 반려할 수 있다", () => {
      expect(canAdvancePricing("DETECTED", "REJECTED")).toBe(true);
    });
  });

  describe("미래 시점 적용 (TASK-3201, CTO 정책 3201-③)", () => {
    const now = at("2026-08-01T00:00:00.000Z");

    it("미지정은 즉시 적용이다", () => {
      expect(validateEffectiveFrom(null, now)).toBeNull();
      expect(validateEffectiveFrom(undefined, now)).toBeNull();
    });

    it("미래 시각은 예약할 수 있다", () => {
      expect(validateEffectiveFrom(at("2026-09-01T00:00:00.000Z"), now)).toBeNull();
    });

    it("과거 시점은 거부한다 — 이미 기록된 비용을 소급해 다시 해석한다", () => {
      const reason = validateEffectiveFrom(at("2026-07-01T00:00:00.000Z"), now);
      expect(reason).toContain("과거 시점으로 적용할 수 없습니다");
      expect(reason).toContain("불일치로 바뀝니다");
    });

    it("시계 오차 정도는 즉시로 본다", () => {
      // 화면이 보낸 "지금"이 서버보다 몇 초 뒤일 수 있다
      expect(
        validateEffectiveFrom(new Date(now.getTime() - 5_000), now),
      ).toBeNull();
    });

    it("너무 먼 예약은 거부한다 — 그때가 되면 아무도 이유를 모른다", () => {
      const far = new Date(
        now.getTime() + (EFFECTIVE_FROM_MAX_DAYS + 1) * 86_400_000,
      );
      expect(validateEffectiveFrom(far, now)).toContain(
        `최대 ${EFFECTIVE_FROM_MAX_DAYS}일`,
      );
    });

    it("예약된 단가는 그 시각까지 계산에 쓰이지 않는다", () => {
      const scheduled: AppliedPricing[] = [
        {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          // 오늘 결정하고 9월 1일부터 발효
          appliedAt: now,
          effectiveFrom: at("2026-09-01T00:00:00.000Z"),
        },
      ];
      expect(
        resolvePricingAt(defaults, scheduled, now).ocr["google-vision"].perUnitUsd,
      ).toBe(0.0015);
      expect(
        resolvePricingAt(defaults, scheduled, at("2026-09-01T00:00:00.000Z")).ocr[
          "google-vision"
        ].perUnitUsd,
      ).toBe(0.002);
    });

    it("출처 문구는 발효 시각을 적는다 — 결정 시각이 아니다", () => {
      const scheduled: AppliedPricing[] = [
        {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          appliedAt: now,
          effectiveFrom: at("2026-09-01T00:00:00.000Z"),
        },
      ];
      expect(
        resolvePricingAt(defaults, scheduled, at("2026-09-02T00:00:00.000Z")).ocr[
          "google-vision"
        ].note,
      ).toContain("2026-09-01");
    });

    it("다음 변경 시각을 알려 준다 — 캐시가 그 시각을 넘기면 예약이 무시된다", () => {
      const rows: AppliedPricing[] = [
        {
          target: "ocr",
          key: "google-vision",
          price: { perUnitUsd: 0.002 },
          appliedAt: now,
          effectiveFrom: at("2026-09-01T00:00:00.000Z"),
        },
        {
          target: "llm",
          key: "gpt-4o",
          price: { inputPerMillion: 3, outputPerMillion: 12 },
          appliedAt: now,
          effectiveFrom: at("2026-08-15T00:00:00.000Z"),
        },
      ];
      expect(nextPricingChangeAt(rows, now)?.toISOString()).toBe(
        "2026-08-15T00:00:00.000Z",
      );
      // 예약이 모두 지나갔으면 없다
      expect(nextPricingChangeAt(rows, at("2026-10-01T00:00:00.000Z"))).toBeNull();
    });

    it("문구가 예약인지 발효인지 가른다", () => {
      expect(describeEffectiveFrom(at("2026-09-01T00:00:00.000Z"), now)).toContain(
        "적용 예정",
      );
      expect(describeEffectiveFrom(at("2026-07-01T00:00:00.000Z"), now)).toContain(
        "적용됨",
      );
    });

    it("예약된 제안의 문구는 이미 쓰인다고 말하지 않는다", () => {
      const text = describePricingProposal({
        target: "ocr",
        key: "google-vision",
        stage: "APPLIED",
        price: { perUnitUsd: 0.002 },
        currentPrice: { perUnitUsd: 0.0015 },
        effectiveFrom: at("2026-09-01T00:00:00.000Z"),
        now,
      });
      expect(text).toContain("2026-09-01T00:00:00.000Z부터 이 단가가 쓰입니다");
      expect(text).toContain("예약");
    });
  });

  describe("실효 가격표와 시점별 단가 (정책 3101-②의 동반자)", () => {
    const applied: AppliedPricing[] = [
      {
        target: "llm",
        key: "gpt-4o",
        price: { inputPerMillion: 3, outputPerMillion: 12 },
        appliedAt: at("2026-07-10T00:00:00.000Z"),
        effectiveFrom: at("2026-07-10T00:00:00.000Z"),
      },
      {
        target: "ocr",
        key: "google-vision",
        price: { perUnitUsd: 0.002 },
        appliedAt: at("2026-07-20T00:00:00.000Z"),
        effectiveFrom: at("2026-07-20T00:00:00.000Z"),
      },
    ];

    it("적용된 제안이 기준 가격표를 덮는다", () => {
      const effective = resolvePricingAt(defaults, applied);
      expect(effective.llm["gpt-4o"]).toEqual({
        inputPerMillion: 3,
        outputPerMillion: 12,
      });
      expect(effective.ocr["google-vision"].perUnitUsd).toBe(0.002);
      // 손대지 않은 항목은 기본값 그대로다
      expect(effective.llm["gpt-4o-mini"]).toEqual(
        DEFAULT_LLM_PRICING["gpt-4o-mini"],
      );
    });

    it("시점을 주면 그때까지 적용된 것만 반영한다", () => {
      // 과거 기록을 다시 계산하지 않고도 "그때 기준으로 맞았는가"를 물을 수 있다
      const before = resolvePricingAt(defaults, applied, at("2026-07-05T00:00:00.000Z"));
      expect(before.llm["gpt-4o"]).toEqual(DEFAULT_LLM_PRICING["gpt-4o"]);
      expect(before.ocr["google-vision"].perUnitUsd).toBe(0.0015);

      const middle = resolvePricingAt(defaults, applied, at("2026-07-15T00:00:00.000Z"));
      expect(middle.llm["gpt-4o"].inputPerMillion).toBe(3);
      expect(middle.ocr["google-vision"].perUnitUsd).toBe(0.0015);
    });

    it("적용 시각이 같은 시점은 포함한다 (경계)", () => {
      const exact = resolvePricingAt(defaults, applied, at("2026-07-10T00:00:00.000Z"));
      expect(exact.llm["gpt-4o"].inputPerMillion).toBe(3);
    });

    it("같은 키에 여러 번 적용되면 가장 늦은 것이 이긴다", () => {
      const twice: AppliedPricing[] = [
        ...applied,
        {
          target: "llm",
          key: "gpt-4o",
          price: { inputPerMillion: 5, outputPerMillion: 20 },
          appliedAt: at("2026-07-25T00:00:00.000Z"),
          effectiveFrom: at("2026-07-25T00:00:00.000Z"),
        },
      ];
      expect(resolvePricingAt(defaults, twice).llm["gpt-4o"].inputPerMillion).toBe(
        5,
      );
      // 순서가 뒤섞여 들어와도 결과는 같다
      expect(
        resolvePricingAt(defaults, [...twice].reverse()).llm["gpt-4o"]
          .inputPerMillion,
      ).toBe(5);
    });

    it("가격표에 없던 항목도 추가할 수 있다", () => {
      const added = resolvePricingAt(defaults, [
        {
          target: "llm",
          key: "gpt-5-preview",
          price: { inputPerMillion: 1, outputPerMillion: 4 },
          appliedAt: at("2026-07-01T00:00:00.000Z"),
          effectiveFrom: at("2026-07-01T00:00:00.000Z"),
        },
      ]);
      expect(added.llm["gpt-5-preview"]).toBeDefined();
    });

    it("적용된 OCR 단가는 출처를 남긴다 — 코드 기본값과 구분되어야 한다", () => {
      expect(resolvePricingAt(defaults, applied).ocr["google-vision"].note).toContain(
        "승인된 제안으로 적용됨",
      );
    });

    it("기준 가격표를 변형하지 않는다", () => {
      resolvePricingAt(defaults, applied);
      expect(DEFAULT_LLM_PRICING["gpt-4o"].inputPerMillion).toBe(2.5);
      expect(DEFAULT_OCR_PRICING["google-vision"].perUnitUsd).toBe(0.0015);
    });
  });

  describe("문구", () => {
    it("무엇에서 무엇으로 바뀌고 지금 무엇을 기다리는지 말한다", () => {
      const text = describePricingProposal({
        target: "llm",
        key: "gpt-4o",
        stage: "REVIEWED",
        price: { inputPerMillion: 3, outputPerMillion: 12 },
        currentPrice: { inputPerMillion: 2.5, outputPerMillion: 10 },
      });
      expect(text).toContain("입력 $2.5/1M");
      expect(text).toContain("입력 $3/1M");
      expect(text).toContain("검토됨 — 승인을 기다립니다");
    });

    it("가격표에 없던 항목이라고 말한다", () => {
      expect(
        describePricingProposal({
          target: "ocr",
          key: "clova",
          stage: "DRAFT",
          price: { perUnitUsd: 0.001 },
          currentPrice: null,
        }),
      ).toContain("가격표에 없던 항목");
    });

    it("적용된 제안은 이후 호출에 쓰인다고 말한다", () => {
      expect(
        describePricingProposal({
          target: "ocr",
          key: "google-vision",
          stage: "APPLIED",
          price: { perUnitUsd: 0.002 },
          currentPrice: { perUnitUsd: 0.0015 },
        }),
      ).toContain("이후 호출에 이 단가가 쓰입니다");
    });

    it("마크다운 강조가 새지 않는다", () => {
      for (const stage of PRICING_STAGES) {
        expect(
          describePricingProposal({
            target: "llm",
            key: "m",
            stage,
            price: { inputPerMillion: 1, outputPerMillion: 1 },
            currentPrice: null,
          }),
        ).not.toContain("**");
      }
    });
  });
  describe("2단계 승인 (TASK-3301, CTO 정책 3301-②)", () => {
    it("시스템이 만든 제안은 운영에서 최종 승인이 필요하다", () => {
      // 사람이 낸 제안은 제안자·승인자가 이미 둘이지만, 시스템 제안은
      // 승인자 한 명이 곧 전부다
      for (const origin of ["detected", "published"] as const) {
        expect(isAutoOrigin(origin)).toBe(true);
        expect(requiresSecondApproval(origin, "production")).toBe(true);
        expect(requiresSecondApproval(origin, "development")).toBe(false);
      }
      expect(requiresSecondApproval("manual", "production")).toBe(false);
    });

    it("운영에서 시스템 제안은 승인 뒤 바로 적용할 수 없다", () => {
      const judged = judgePricingTransition("APPROVED", "APPLIED", {
        origin: "detected",
        environment: "production",
      });
      expect(judged.ok).toBe(false);
      expect(judged.reason).toContain("다른 ADMIN의 최종 승인");
      // 무엇을 하면 되는지 말한다
      expect(judged.reason).toContain("최종 승인(confirm)");
    });

    it("최종 승인을 거치면 적용할 수 있다", () => {
      expect(
        judgePricingTransition("CONFIRMED", "APPLIED", {
          origin: "detected",
          environment: "production",
        }).ok,
      ).toBe(true);
    });

    it("사람이 낸 제안과 개발 환경은 그대로 적용한다", () => {
      expect(
        judgePricingTransition("APPROVED", "APPLIED", {
          origin: "manual",
          environment: "production",
        }).ok,
      ).toBe(true);
      expect(
        judgePricingTransition("APPROVED", "APPLIED", {
          origin: "detected",
          environment: "development",
        }).ok,
      ).toBe(true);
    });

    it("더 보수적으로 가는 길은 막지 않는다", () => {
      // 개발에서도, 사람이 낸 제안도 최종 승인을 한 번 더 받을 수 있다
      expect(canAdvancePricing("APPROVED", "CONFIRMED")).toBe(true);
    });

    it("최종 승인자는 1차 승인자와 달라야 한다 (운영)", () => {
      const judged = judgeSecondApproval({
        approvedBy: "a@acos.local",
        confirmedBy: "a@acos.local",
        environment: "production",
      });
      expect(judged.allowed).toBe(false);
      expect(judged.message).toContain("다른 ADMIN의 최종 승인이 필요합니다");
    });

    it("개발에서는 같아도 진행하되 사실을 남긴다", () => {
      const judged = judgeSecondApproval({
        approvedBy: "a@acos.local",
        confirmedBy: "a@acos.local",
        environment: "development",
      });
      expect(judged.allowed).toBe(true);
      expect(judged.message).toContain("확인은 한 번뿐입니다");
    });

    it("다르면 통과한다", () => {
      expect(
        judgeSecondApproval({
          approvedBy: "a@acos.local",
          confirmedBy: "b@acos.local",
          environment: "production",
        }).message,
      ).toBeNull();
    });

    it("최종 승인 뒤에도 반려할 수 있다", () => {
      expect(canAdvancePricing("CONFIRMED", "REJECTED")).toBe(true);
    });
  });

  describe("예약 취소 (TASK-3301, CTO 정책 3301-③)", () => {
    const now = at("2026-08-01T00:00:00.000Z");

    it("아직 발효되지 않은 예약은 취소할 수 있다", () => {
      const judged = judgeScheduleCancel({
        stage: "APPLIED",
        effectiveFrom: at("2026-09-01T00:00:00.000Z"),
        now,
      });
      expect(judged.ok).toBe(true);
      // 삭제가 아니라 기록으로 남는다
      expect(judged.reason).toContain("기록은 남습니다");
    });

    it("이미 발효된 단가는 취소할 수 없다", () => {
      // 취소하면 그 뒤에 기록된 비용이 어떤 단가로 계산됐는지 설명할 수 없다
      const judged = judgeScheduleCancel({
        stage: "APPLIED",
        effectiveFrom: at("2026-07-01T00:00:00.000Z"),
        now,
      });
      expect(judged.ok).toBe(false);
      expect(judged.reason).toContain("이미 발효된 단가입니다");
      expect(judged.reason).toContain("새 제안을 내세요");
    });

    it("적용 전 제안은 취소가 아니라 반려다", () => {
      const judged = judgeScheduleCancel({
        stage: "APPROVED",
        effectiveFrom: null,
        now,
      });
      expect(judged.ok).toBe(false);
      expect(judged.reason).toContain("반려하세요");
    });

    it("취소된 예약은 되살리지 않는다", () => {
      const judged = judgePricingTransition("CANCELLED", "APPLIED");
      expect(judged.ok).toBe(false);
      expect(judged.reason).toContain("취소 기록은 남기고 되살리지 않습니다");
    });

    it("적용에서 갈 수 있는 곳은 취소뿐이다", () => {
      expect(nextPricingStages("APPLIED")).toEqual(["CANCELLED"]);
    });
  });
});
