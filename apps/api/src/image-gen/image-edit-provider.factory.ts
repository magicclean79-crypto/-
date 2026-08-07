import { Logger } from "@nestjs/common";
import { MockImageEditProvider } from "@acos/core";
import type { ImageEditProvider } from "@acos/core";
import { GeminiImageProvider } from "./providers/gemini-image.provider";

/**
 * 이미지 생성/편집 Provider 선택. (Sprint 36 — CTO 지시: Gemini는 배경
 * 제거·배경 생성·제품 합성 담당) `apps/api/src/llm/provider.factory.ts`의
 * `createLlmProvider()`와 같은 원칙 — 키가 없으면 mock으로 조용히
 * 대체해 키 미설정 환경에서도 항상 기동한다. 지금은 Gemini만 실제
 * 이미지 생성/편집을 지원해(TASK 조사, 2026-08-08) 텍스트 LLM처럼
 * 여러 Provider를 라우팅하지 않는다 — 나중에 다른 Provider가 추가되면
 * `provider.factory.ts`처럼 테이블을 늘린다.
 */
export function createImageEditProvider(): ImageEditProvider {
  const logger = new Logger("ImageEditProviderFactory");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn("GEMINI_API_KEY가 없어 이미지 생성은 mock으로 대체합니다.");
    return new MockImageEditProvider();
  }
  return new GeminiImageProvider({
    apiKey,
    model: process.env.GEMINI_IMAGE_MODEL,
  });
}
