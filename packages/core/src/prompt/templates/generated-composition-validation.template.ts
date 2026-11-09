import type { PromptTemplate } from "../prompt-engine";

export const GENERATED_COMPOSITION_VALIDATION_TEMPLATE_KEY = "generated-composition-validation";

export interface GeneratedCompositionValidationContext {
  category: string;
  narrativeRole: string;
  purpose: string;
  /** Product Identity Pack의 prohibitedVariations — 이 목록과 어긋나는지 확인 */
  prohibitedVariations: string[];
}

/**
 * 생성된 composition 이미지 사후 검증 프롬프트. (T1-153)
 *
 * 이 파이프라인에 지금까지 없던 단계 — 실제로 만들어진 이미지 픽셀을
 * 다시 Vision LLM에게 보여 "글자가 그려졌는가"·"제품 정체성이 지켜졌는가"
 * 만 기계적으로 판정한다. **품질(예쁜가/좋은가)은 절대 묻지 않는다** —
 * `docs/MASTER_GUIDE.md` "AI가 만든 것을 AI가 검사하면 검증이 아니다"
 * 원칙을 지키기 위해, 이 프롬프트가 판정하는 항목은 전부 사람이 사진만
 * 봐도 예/아니오로 확인 가능한 사실(글자 유무·구성품 개수 불일치 등)로
 * 좁힌다 — "구도가 좋다"·"프리미엄스럽다" 같은 주관적 판단은 절대 묻지
 * 않는다. 최종 미적 판단은 여전히 사람의 몫이다.
 */
export const GENERATED_COMPOSITION_VALIDATION_TEMPLATE: PromptTemplate<GeneratedCompositionValidationContext> = {
  key: GENERATED_COMPOSITION_VALIDATION_TEMPLATE_KEY,
  name: "생성된 Composition 사후 검증",
  description: "생성된 이미지 1장에 글자가 그려졌는지, Product Identity Pack의 제약과 어긋나는지만 기계적으로 판정한다",
  build(context) {
    const systemLines = [
      "너는 이미지 검수 도구다 — 예술적 판단이나 미적 평가를 하지 않는다.",
      "첨부된 이미지 한 장만 보고 아래 두 가지만 사실 그대로 확인한다:",
      "1) containsVisibleText — 이미지 안에 사람이 읽을 수 있는 글자·숫자·로고·문자가 " +
        "하나라도 그려져 있는가(제품 자체에 원래 새겨진 것이 아니라 이 이미지 생성 " +
        "과정에서 새로 그려진 것으로 보이는 것도 포함).",
      "2) identityMismatch — 아래 '절대 바뀌면 안 되는 것' 목록과 명백히 어긋나는 " +
        "것이 이미지에 보이는가(예: 목록에 없는 구성품이 추가로 보임, 목록에 적힌 " +
        "재질과 명백히 다른 재질로 보임).",
      "구도·미감·완성도는 절대 평가하지 않는다 — 이 두 가지 사실 확인만 한다.",
      "",
      "JSON 객체 하나만 출력한다: containsVisibleText(boolean) · textFound(string 배열, " +
        "실제로 읽은 글자들 — 없으면 빈 배열) · identityMismatch(boolean) · " +
        "mismatchNotes(string 배열, 무엇이 왜 어긋나 보이는지 — 없으면 빈 배열)",
    ];
    const userLines = [
      `카테고리: ${context.category} / 서사 역할: ${context.narrativeRole}`,
      `목적: ${context.purpose}`,
      "",
      "절대 바뀌면 안 되는 것(Product Identity Pack):",
      context.prohibitedVariations.length > 0
        ? context.prohibitedVariations.map((v) => `- ${v}`).join("\n")
        : "- (특별히 지정된 항목 없음)",
      "",
      "첨부된 이미지를 위 기준으로 확인해 JSON 객체 하나만 출력해줘.",
    ];
    return [
      { role: "system", content: systemLines.join("\n") },
      { role: "user", content: userLines.join("\n") },
    ];
  },
};
