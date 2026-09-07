import { Logger } from "@nestjs/common";
import { MockImageEditProvider } from "@acos/core";
import type { ImageEditProvider } from "@acos/core";
import { GeminiImageProvider } from "./providers/gemini-image.provider";
import { OpenAiImageProvider } from "./providers/openai-image.provider";

type ImageEditProviderName = "openai" | "gemini" | "mock";

/**
 * 이미지 생성/편집 Provider 선택. (Sprint 36 — Gemini 배경 제거/생성/합성 →
 * T1-150 — GPT Image 2를 primary visual composition generator로 전환.)
 *
 * `apps/api/src/llm/provider.factory.ts`의 `createLlmProvider()`와 같은
 * 원칙 — 키가 없으면 mock으로 조용히 대체해 키 미설정 환경에서도 항상
 * 기동한다. `ImageEditProvider` Port(@acos/core) 하나 뒤에 Provider를
 * 여러 개 두고 `IMAGE_GEN_PROVIDER` 환경변수로 교체 가능하게 한다 —
 * 렌더러·서비스 코드는 어떤 Provider가 실제로 이미지를 만들었는지 몰라도
 * 된다(요청 사양 5).
 *
 * **기본값(OPENAI_API_KEY가 있으면 "openai")은 실측 벤치마크로 정했다** —
 * T1-150에서 동일 Benchmark 제품·동일 Art Direction Contract로 Gemini와
 * GPT Image 2를 HERO/USAGE_SCENE/DETAIL 3종 비교 생성했고, 결과는
 * `docs/PROJECT_STATE.md`(T1-150 절)에 근거와 함께 기록했다. 사람이 다시
 * 바꾸고 싶으면 `IMAGE_GEN_PROVIDER=gemini`(또는 `mock`)로 명시한다 —
 * 이 함수는 그 값을 최우선으로 따른다.
 */
function resolveProviderName(): ImageEditProviderName {
  const explicit = process.env.IMAGE_GEN_PROVIDER?.trim().toLowerCase();
  if (explicit === "openai" || explicit === "gemini" || explicit === "mock") {
    return explicit;
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }
  if (process.env.GEMINI_API_KEY) {
    return "gemini";
  }
  return "mock";
}

export function createImageEditProvider(): ImageEditProvider {
  const logger = new Logger("ImageEditProviderFactory");
  const name = resolveProviderName();

  if (name === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      logger.warn("IMAGE_GEN_PROVIDER=openai이지만 OPENAI_API_KEY가 없어 mock으로 대체합니다.");
      return new MockImageEditProvider();
    }
    return new OpenAiImageProvider({ apiKey, model: process.env.OPENAI_IMAGE_MODEL });
  }

  if (name === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      logger.warn("IMAGE_GEN_PROVIDER=gemini이지만 GEMINI_API_KEY가 없어 mock으로 대체합니다.");
      return new MockImageEditProvider();
    }
    return new GeminiImageProvider({ apiKey, model: process.env.GEMINI_IMAGE_MODEL });
  }

  return new MockImageEditProvider();
}
