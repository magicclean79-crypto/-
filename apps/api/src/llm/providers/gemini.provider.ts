import { GoogleGenAI } from "@google/genai";
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";
import type { LlmProvider, LlmRequest, LlmResult } from "@acos/core";

const DEFAULT_MODEL = "gemini-2.5-flash";

/** 테스트에서 대체 가능한 최소 클라이언트 표면 (models.generateContent) */
export interface GeminiGenerateClient {
  models: {
    generateContent: (
      params: GenerateContentParameters,
    ) => Promise<GenerateContentResponse>;
  };
}

/**
 * Google Gemini 어댑터 — 공식 @google/genai SDK 사용.
 * (TASK-0501 · 공식 연결 TASK-0903)
 * GEMINI_API_KEY가 설정된 경우에만 LLM_PROVIDER=gemini로 선택된다.
 *
 * TASK-0903에서 활성화된 것:
 * - responseFormat "json" → `responseMimeType: "application/json"` 매핑
 *   (Gemini 공식 구조화 출력 옵션 — 프롬프트 JSON 지침과 이중 강제)
 * - 잘림 방어: finishReason "MAX_TOKENS" + JSON → 명확한 오류 (Execution
 *   FAILED — OpenAI/Anthropic 어댑터와 동일 정책, CTO 확정 0901-②)
 * - Execution Cost: gemini-2.5-flash 단가가 가격표에 등록됨 (@acos/core)
 * - 테스트용 클라이언트 주입 지원
 */
export class GeminiLlmProvider implements LlmProvider {
  readonly name = "gemini";
  readonly defaultModel: string;
  private readonly client: GeminiGenerateClient;

  constructor(options: {
    apiKey: string;
    model?: string;
    /** 테스트 전용 — 미지정 시 공식 SDK 클라이언트 생성 */
    client?: GeminiGenerateClient;
  }) {
    this.client =
      options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
    this.defaultModel = options.model ?? DEFAULT_MODEL;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    // Gemini는 system 지침(systemInstruction)과 대화(contents)를 분리해 받는다
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    const contents = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }] as (
          | { text: string }
          | { inlineData: { mimeType: string; data: string } }
        )[],
      }));

    // 첨부 이미지(멀티모달)는 inlineData part로 마지막 user 메시지 앞에 붙인다
    if (request.images && request.images.length > 0) {
      const lastUserIndex = contents
        .map((content) => content.role)
        .lastIndexOf("user");
      const target = contents[lastUserIndex];
      if (target) {
        target.parts = [
          ...request.images.map((image) => ({
            inlineData: { mimeType: image.mimeType, data: image.base64 },
          })),
          ...target.parts,
        ];
      }
    }

    const model = request.model ?? this.defaultModel;
    const response = await this.client.models.generateContent({
      model,
      contents,
      config: {
        ...(system.length > 0 ? { systemInstruction: system } : {}),
        ...(request.maxTokens !== undefined
          ? { maxOutputTokens: request.maxTokens }
          : {}),
        // 구조화 출력 (TASK-0903) — Gemini 공식 JSON 모드
        ...(request.responseFormat === "json"
          ? { responseMimeType: "application/json" }
          : {}),
      },
    });

    // 운영 방어 (TASK-0903 — 0901-② 정책): JSON 출력이 max tokens에서 잘리면
    // 명확한 오류로 실패시킨다. 텍스트 출력은 부분 결과 허용.
    const finishReason = response.candidates?.[0]?.finishReason;
    if (
      String(finishReason) === "MAX_TOKENS" &&
      request.responseFormat === "json"
    ) {
      throw new Error(
        `Gemini 응답이 출력 한도(max tokens)에서 잘려 JSON을 완성하지 못했습니다 — ` +
          `LLM_*_MAX_TOKENS 한도를 늘리거나 프롬프트를 줄여 주세요. (model: ${model})`,
      );
    }

    // 토큰 상세 (TASK-4701, 지시 2).
    //
    // Gemini는 **두 군데**가 어긋납니다:
    // ① `promptTokenCount`는 캐시 토큰을 **포함**합니다(OpenAI 모양) — 빼야
    //    합니다.
    // ② 생각 토큰(`thoughtsTokenCount`)이 `candidatesTokenCount`에 **없습니다**.
    //    그런데 청구는 됩니다 — 그래서 이 값을 더하지 않으면 **출력을 덜
    //    세고**, 생각을 많이 한 호출일수록 더 크게 어긋납니다.
    const meta = response.usageMetadata as
      | (NonNullable<typeof response.usageMetadata> & {
          thoughtsTokenCount?: number | null;
        })
      | undefined;
    const promptTokens = meta?.promptTokenCount ?? null;
    const cachedTokens = meta?.cachedContentTokenCount ?? null;
    const candidateTokens = meta?.candidatesTokenCount ?? null;
    const thoughtTokens = meta?.thoughtsTokenCount ?? null;

    return {
      provider: this.name,
      // 응답의 스냅샷 모델명 우선 (비용 접두사 매칭) — 없으면 요청 모델
      model: response.modelVersion ?? model,
      text: response.text ?? "",
      usage: {
        inputTokens:
          promptTokens === null
            ? null
            : Math.max(0, promptTokens - (cachedTokens ?? 0)),
        outputTokens:
          candidateTokens === null
            ? null
            : candidateTokens + (thoughtTokens ?? 0),
      },
      usageDetail: {
        cachedInputTokens: cachedTokens,
        // Gemini의 캐시 쓰기는 저장 시간당 과금이라 **호출 단위로 셀 수
        // 없습니다.** 개념이 다르므로 이 칸에 담지 않습니다 — 담으면
        // 호출 비용에 섞여 어느 쪽도 못 믿게 됩니다.
        cacheWriteTokens: null,
        reasoningTokens: thoughtTokens,
      },
      raw: response,
    };
  }
}
