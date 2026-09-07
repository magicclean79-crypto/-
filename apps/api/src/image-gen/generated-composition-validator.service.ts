import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  GENERATED_COMPOSITION_VALIDATION_TEMPLATE_KEY,
  parseGeneratedCompositionValidationResponse,
  type GeneratedCompositionValidationResult,
  type PromptEngine,
} from "@acos/core";
import { LlmService } from "../llm/llm.service";
import { PROMPT_ENGINE } from "../prompt/prompt.constants";

export interface ValidateGeneratedCompositionInput {
  imageBase64: string;
  mimeType: string;
  category: string;
  narrativeRole: string;
  purpose: string;
  prohibitedVariations: string[];
  projectId?: string;
}

/**
 * 생성된 Composition 사후 검증 서비스. (T1-153)
 *
 * ChatGPT가 상세페이지를 만들 때와 달리, 지금까지 이 파이프라인은
 * "생성 요청을 얼마나 정확히 지시했는가"(Art Direction Contract·Product
 * Identity Pack)까지만 통제했지, **실제로 나온 이미지 픽셀**을 다시
 * 확인하는 단계가 없었다(선행 조사에서 확인된 공백). 이 서비스가 그
 * 공백을 채운다 — 단, `docs/MASTER_GUIDE.md`의 "AI가 만든 것을 AI가
 * 검사하면 검증이 아니다" 원칙을 지키기 위해 **주관적 품질 판단은 절대
 * 하지 않는다.** 확인하는 것은 딱 두 가지 사실뿐이다: (1) 이미지 안에
 * 글자가 그려졌는가(금지 규칙 위반), (2) Product Identity Pack의
 * prohibitedVariations와 명백히 어긋나는 것이 보이는가. "구도가 좋다"·
 * "프리미엄스럽다" 같은 판단은 하지 않는다 — 그건 여전히 사람의 몫이다.
 *
 * **비용 게이트(`IMAGE_VALIDATION_ENABLED`)** — 이 검증은 Vision LLM을
 * 한 번 더 호출하므로 이미지 1장당 추가 과금이 발생한다. "실 API 호출은
 * 꼭 필요할 때만"이라는 이 프로젝트의 비용 최소화 원칙에 따라, 이 서비스
 * 자체는 항상 주입되지만 **호출 여부는 `ImageGenService`가 환경변수로
 * 판단한다** — 기본값은 꺼짐(off)이다. 켜져 있을 때만 실제로 호출된다.
 */
@Injectable()
export class GeneratedCompositionValidatorService {
  private readonly logger = new Logger(GeneratedCompositionValidatorService.name);

  constructor(
    private readonly llm: LlmService,
    @Optional() @Inject(PROMPT_ENGINE) private readonly promptEngine?: PromptEngine,
  ) {}

  async validate(input: ValidateGeneratedCompositionInput): Promise<GeneratedCompositionValidationResult> {
    if (!this.promptEngine) {
      // Prompt Engine이 없는 최소 구성(단위 테스트 등)에서는 검증 자체를
      // 시도하지 않는다 — 호출자가 "검증하지 않았다"를 알 수 있도록
      // parsed:false로 보수적으로 답한다(통과로 위장하지 않는다).
      return {
        parsed: false,
        containsVisibleText: true,
        identityMismatch: true,
        textFound: [],
        mismatchNotes: ["Prompt Engine이 연결되지 않아 검증을 시도하지 않았습니다."],
        ok: false,
      };
    }
    const messages = this.promptEngine.render(GENERATED_COMPOSITION_VALIDATION_TEMPLATE_KEY, {
      category: input.category,
      narrativeRole: input.narrativeRole,
      purpose: input.purpose,
      prohibitedVariations: input.prohibitedVariations,
    });
    try {
      const completion = await this.llm.complete(
        {
          messages,
          images: [{ mimeType: input.mimeType, base64: input.imageBase64 }],
          responseFormat: "json",
        },
        { feature: "generated-composition-validation", projectId: input.projectId },
      );
      return parseGeneratedCompositionValidationResponse(completion.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`생성된 composition 검증 호출 실패 — 원본 이미지는 그대로 유지합니다: ${message}`);
      return {
        parsed: false,
        containsVisibleText: false,
        identityMismatch: false,
        textFound: [],
        mismatchNotes: [`검증 호출 자체가 실패함(${message}) — 이미지는 그대로 두고 실패만 기록`],
        ok: true,
      };
    }
  }
}
