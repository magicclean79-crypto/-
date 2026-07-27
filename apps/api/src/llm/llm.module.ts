import { Logger, Module } from "@nestjs/common";
import { MockLlmProvider, type LlmProvider } from "@acos/core";
import { LLM_PROVIDER } from "./llm.constants";
import { LlmController } from "./llm.controller";
import { LlmService } from "./llm.service";
import { AnthropicLlmProvider } from "./providers/anthropic.provider";
import { GeminiLlmProvider } from "./providers/gemini.provider";
import { OpenAiLlmProvider } from "./providers/openai.provider";

/**
 * LLM_PROVIDER 환경 변수로 Provider를 선택한다. (기본: mock — 실제 API 미호출)
 *
 * - openai:    OPENAI_API_KEY 필요    (모델: LLM_OPENAI_MODEL, 기본 gpt-4o)
 * - anthropic: ANTHROPIC_API_KEY 필요 (모델: LLM_ANTHROPIC_MODEL, 기본 claude-opus-5)
 * - gemini:    GEMINI_API_KEY 필요    (모델: LLM_GEMINI_MODEL, 기본 gemini-2.5-flash)
 *
 * API 키가 없으면 경고 후 mock으로 대체한다 — 키 미설정 환경에서도 항상 기동.
 * 새 Provider는 @acos/core의 LlmProvider를 구현한 뒤 case 하나만 추가하면 된다.
 */
export function createLlmProvider(): LlmProvider {
  const logger = new Logger("LlmModule");
  const name = (process.env.LLM_PROVIDER ?? "mock").toLowerCase();

  const requireKey = (envVar: string): string | null => {
    const key = process.env[envVar];
    if (!key) {
      logger.warn(
        `LLM_PROVIDER="${name}"이지만 ${envVar}가 없어 mock으로 대체합니다.`,
      );
      return null;
    }
    return key;
  };

  switch (name) {
    case "mock":
      return new MockLlmProvider();
    case "openai": {
      const apiKey = requireKey("OPENAI_API_KEY");
      return apiKey
        ? new OpenAiLlmProvider({ apiKey, model: process.env.LLM_OPENAI_MODEL })
        : new MockLlmProvider();
    }
    case "anthropic": {
      const apiKey = requireKey("ANTHROPIC_API_KEY");
      return apiKey
        ? new AnthropicLlmProvider({
            apiKey,
            model: process.env.LLM_ANTHROPIC_MODEL,
          })
        : new MockLlmProvider();
    }
    case "gemini": {
      const apiKey = requireKey("GEMINI_API_KEY");
      return apiKey
        ? new GeminiLlmProvider({
            apiKey,
            model: process.env.LLM_GEMINI_MODEL,
          })
        : new MockLlmProvider();
    }
    default:
      logger.warn(`알 수 없는 LLM_PROVIDER "${name}" — mock으로 대체합니다.`);
      return new MockLlmProvider();
  }
}

@Module({
  controllers: [LlmController],
  providers: [
    LlmService,
    {
      provide: LLM_PROVIDER,
      useFactory: createLlmProvider,
    },
  ],
  exports: [LlmService],
})
export class LlmModule {}
