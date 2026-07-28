import { Logger } from "@nestjs/common";
import { LLM_PROVIDER_REGISTRY, MockLlmProvider } from "@acos/core";
import type { LlmProvider } from "@acos/core";
import { AnthropicLlmProvider } from "./providers/anthropic.provider";
import { GeminiLlmProvider } from "./providers/gemini.provider";
import { OpenAiLlmProvider } from "./providers/openai.provider";

/**
 * Provider Factory (TASK-0903, Sprint 9 — Multi-Provider).
 *
 * Registry(`LLM_PROVIDER_REGISTRY`, core) 기반 테이블 드리븐 생성 —
 * `LLM_PROVIDER` 환경 변수로 Provider를 선택한다 (기본: mock — 실제 API
 * 미호출). 키 환경변수는 Registry가 단일 정의하고, 키가 없으면 경고 후
 * mock으로 대체한다 (키 미설정 환경에서도 항상 기동).
 *
 * 새 Provider 추가 절차(3곳): ① Registry에 선언(core) ② 어댑터 구현 +
 * 아래 테이블에 1줄 ③ 가격표(DEFAULT_LLM_PRICING)에 단가 등록.
 */

/** Provider별 모델 덮어쓰기 환경변수 */
const MODEL_ENV: Record<string, string> = {
  openai: "LLM_OPENAI_MODEL",
  anthropic: "LLM_ANTHROPIC_MODEL",
  gemini: "LLM_GEMINI_MODEL",
};

/** Provider별 어댑터 생성자 — Registry의 name과 1:1 */
const ADAPTERS: Record<
  string,
  (options: { apiKey: string; model?: string }) => LlmProvider
> = {
  openai: (options) => new OpenAiLlmProvider(options),
  anthropic: (options) => new AnthropicLlmProvider(options),
  gemini: (options) => new GeminiLlmProvider(options),
};

export function createLlmProvider(): LlmProvider {
  const logger = new Logger("LlmProviderFactory");
  const name = (process.env.LLM_PROVIDER ?? "mock").toLowerCase();
  if (name === "mock") {
    return new MockLlmProvider();
  }

  const info = LLM_PROVIDER_REGISTRY.find((entry) => entry.name === name);
  const adapter = ADAPTERS[name];
  if (!info || !adapter) {
    logger.warn(`알 수 없는 LLM_PROVIDER "${name}" — mock으로 대체합니다.`);
    return new MockLlmProvider();
  }

  const apiKey = info.keyEnv ? process.env[info.keyEnv] : undefined;
  if (!apiKey) {
    logger.warn(
      `LLM_PROVIDER="${name}"이지만 ${info.keyEnv}가 없어 mock으로 대체합니다.`,
    );
    return new MockLlmProvider();
  }

  return adapter({ apiKey, model: process.env[MODEL_ENV[name]] });
}
