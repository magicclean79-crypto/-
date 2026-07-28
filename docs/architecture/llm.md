# LLM Gateway Foundation (TASK-0501, Sprint 5 — AI Execution)

모든 LLM 호출이 통과하는 **단일 게이트웨이**입니다. Provider(OpenAI / Anthropic /
Google Gemini)는 환경변수 하나로 교체되며, **기본은 mock** — API 키가 없으면
실제 호출은 일어나지 않습니다.

```
호출 모듈 (향후: 콘텐츠 생성, 분석 …)
   └─▶ LlmService (api) ─▶ LlmGateway (@acos/core — 검증·재시도)
                               └─▶ LlmProvider (Port)
                                     ├── MockLlmProvider   (기본, @acos/core)
                                     ├── OpenAiLlmProvider    (openai SDK)
                                     ├── AnthropicLlmProvider (@anthropic-ai/sdk)
                                     └── GeminiLlmProvider    (@google/genai SDK)
```

## Provider 선택 (환경변수)

| 변수 | 값 | 비고 |
| --- | --- | --- |
| `LLM_PROVIDER` | `mock`(기본) · `openai` · `anthropic` · `gemini` | 키가 없으면 경고 후 mock으로 대체 |
| `OPENAI_API_KEY` / `LLM_OPENAI_MODEL` | — / 기본 `gpt-4o` | openai 선택 시 |
| `ANTHROPIC_API_KEY` / `LLM_ANTHROPIC_MODEL` | — / 기본 `claude-opus-5` | anthropic 선택 시 |
| `GEMINI_API_KEY` / `LLM_GEMINI_MODEL` | — / 기본 `gemini-2.5-flash` | gemini 선택 시 |
| `LLM_MAX_ATTEMPTS` | 기본 3 | 게이트웨이 재시도 횟수 (지수 백오프) |

새 Provider 추가: `@acos/core`의 `LlmProvider`를 구현하고
`apps/api/src/llm/llm.module.ts`의 팩토리에 case 하나를 추가하면 됩니다.

## 구조

- **Port (`packages/core/src/llm/`)** — 프레임워크 무관
  - `LlmProvider`: `name` · `defaultModel` · `complete(request)`
  - `LlmRequest`: `messages`(system/user/assistant) · `model?` · `maxTokens?` ·
    `responseFormat?`("text" 기본 | "json" — 구조화 출력 요구, TASK-0504) ·
    `images?`(`{ mimeType, base64 }[]` — 멀티모달 첨부, TASK-0505.
    검증: mimeType은 "image/*", base64 비어 있지 않음)
  - `LlmResult`: `provider` · `model` · `text` · `usage`(input/outputTokens) · `raw`
  - `LlmGateway`: 요청 검증(빈 메시지·role·공백 content·maxTokens) +
    지수 백오프 재시도 — OcrExecutionService와 같은 결
  - `MockLlmProvider`: 결정적 응답(마지막 user 메시지 반영), 추정 usage.
    `responseFormat: "json"`이면 프롬프트의 마지막 ```json 블록(템플릿이 넣은
    초안)을 그대로 반환 — 구조화 파이프라인의 오프라인 검증용 (TASK-0504).
    첨부 이미지는 해석하지 않고 개수만 raw.imageCount에 기록 (TASK-0505)
- **어댑터 (`apps/api/src/llm/providers/`)** — 공식 SDK 사용
  - Anthropic: system은 별도 파라미터, 응답은 content 블록에서 text 추출
  - **OpenAI (TASK-0603 공식 연결)**: chat.completions —
    `responseFormat "json"` → `response_format { type: "json_object" }` 매핑
    (프롬프트 지침과 이중 강제), 멀티모달 image_url, gpt-4o 계열 단가가
    가격표에 등록되어 Execution Cost 활성화. 테스트용 클라이언트 주입 지원
  - Gemini: systemInstruction/contents 분리, assistant → model role 매핑
  - **이미지 매핑 (TASK-0505)**: `images`는 마지막 user 메시지에 Provider별
    형식으로 첨부된다 — Anthropic `image` content block(base64) · OpenAI
    `image_url`(data URL) · Gemini `inlineData` part
  - Anthropic/Gemini의 `responseFormat` 구조화 출력 옵션 매핑은 해당 Provider
    공식 연결 시 적용한다 (CTO 결정, TASK-0504 승인 — OpenAI는 0603에서 완료)

## Health Check (TASK-0603)

`GET /llm/health` — 실제 최소 완성 호출("ping", maxTokens 16)로 키·네트워크·
모델 접근을 확인한다. 성공 시 `{ status: "ok", latencyMs }`, 실패 시 예외
대신 `{ status: "error", error }` 반환. 이 호출도 Execution(feature "dev")으로
기록되므로 실패 이력이 대시보드에 남는다.

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/llm` | 선택된 Provider 확인 — `{ provider, defaultModel }` |
| `GET` | `/llm/health` | **Provider 상태 점검 (TASK-0603)** — 최소 실호출 기반 |
| `POST` | `/llm/complete` | `{ messages, model?, maxTokens? }` → `{ provider, model, text, usage }` (200) |

오류: `400` 빈 메시지·잘못된 role·공백 content·잘못된 maxTokens.

사용 예:

```json
POST /llm/complete
{
  "messages": [
    { "role": "system", "content": "너는 상품 카피라이터다." },
    { "role": "user", "content": "PVC 매트 상세페이지 도입부를 써줘." }
  ]
}
→ { "provider": "mock", "model": "mock-llm-1", "text": "[mock-llm] …", "usage": { … } }
```

## 원칙·경계

- **mock 기본**: 키 미설정 환경(테스트·CI 포함)에서 실제 API 호출이 절대
  일어나지 않는다. 실제 Provider는 `LLM_PROVIDER` + 해당 API 키를 모두
  설정했을 때만 활성화된다.
- **호출 관측 (TASK-0601)**: 모든 호출은 호출 1건당 **Execution 1건**
  (feature/provider/model/token/cost/latency/status)으로 기록된다 —
  [execution.md](execution.md). 요청/응답 본문은 저장하지 않는다.
- **소비 계층 연결 완료**: Content Generation(0502)·Analysis(0504)·
  Vision(0505)·구 Generator 경로(0506)가 전부 LLM Gateway를 사용한다.
