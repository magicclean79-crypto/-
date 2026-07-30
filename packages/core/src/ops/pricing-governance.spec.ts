import { DEFAULT_LLM_PRICING } from "../execution/execution";
import { DEFAULT_OCR_PRICING } from "../ocr/ocr-pricing";
import {
  PRICING_STAGES,
  PRICING_TARGETS,
  canAdvancePricing,
  describePricingProposal,
  judgePricingTransition,
  nextPricingStages,
  resolvePricingAt,
  selfApprovalWarning,
  validateProposedPrice,
} from "./pricing-governance";
import type { AppliedPricing } from "./pricing-governance";

const defaults = { llm: DEFAULT_LLM_PRICING, ocr: DEFAULT_OCR_PRICING };
const at = (iso: string) => new Date(iso);

describe("가격표 거버넌스 (TASK-3101, CTO 정책 3101-①②)", () => {
  it("대상과 단계를 값으로 고정한다", () => {
    expect([...PRICING_TARGETS]).toEqual(["llm", "ocr"]);
    expect([...PRICING_STAGES]).toEqual([
      "DRAFT",
      "REVIEWED",
      "APPROVED",
      "APPLIED",
      "REJECTED",
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
      expect(nextPricingStages("APPROVED")).toEqual(["APPLIED", "REJECTED"]);
    });

    it("적용 전 어느 단계에서도 반려할 수 있다 — 검토가 통과를 뜻하지 않는다", () => {
      for (const stage of ["DRAFT", "REVIEWED", "APPROVED"] as const) {
        expect(canAdvancePricing(stage, "REJECTED")).toBe(true);
      }
    });

    it("적용된 제안은 되돌릴 수 없다 — 새 제안을 내야 한다", () => {
      expect(nextPricingStages("APPLIED")).toEqual([]);
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
      expect(judged.reason).toContain("가능: APPLIED, REJECTED");
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

  describe("교차 확인", () => {
    it("제안자와 승인자가 같으면 사실을 남긴다 — 막지는 않는다", () => {
      // 운영자가 한 명인 환경에서 절차가 막히면 사람은 코드를 직접 고쳐
      // 우회하고, 그러면 이력이 아예 없어진다 (결정 2601-① 교훈)
      const warning = selfApprovalWarning({
        proposedBy: "admin@acos.local",
        approvedBy: "admin@acos.local",
      });
      expect(warning).toContain("제안자와 승인자가 같습니다");
      expect(warning).toContain("교차 확인은 이뤄지지 않았습니다");
    });

    it("다르면 경고가 없다", () => {
      expect(
        selfApprovalWarning({ proposedBy: "a@x", approvedBy: "b@x" }),
      ).toBeNull();
    });

    it("아직 승인되지 않았으면 경고할 것이 없다", () => {
      expect(
        selfApprovalWarning({ proposedBy: "a@x", approvedBy: null }),
      ).toBeNull();
    });
  });

  describe("실효 가격표와 시점별 단가 (정책 3101-②의 동반자)", () => {
    const applied: AppliedPricing[] = [
      {
        target: "llm",
        key: "gpt-4o",
        price: { inputPerMillion: 3, outputPerMillion: 12 },
        appliedAt: at("2026-07-10T00:00:00.000Z"),
      },
      {
        target: "ocr",
        key: "google-vision",
        price: { perUnitUsd: 0.002 },
        appliedAt: at("2026-07-20T00:00:00.000Z"),
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
});
