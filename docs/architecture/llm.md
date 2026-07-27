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
  - `LlmRequest`: `messages`(system/user/assistant) · `model?` · `maxTokens?`
  - `LlmResult`: `provider` · `model` · `text` · `usage`(input/outputTokens) · `raw`
  - `LlmGateway`: 요청 검증(빈 메시지·role·공백 content·maxTokens) +
    지수 백오프 재시도 — OcrExecutionService와 같은 결
  - `MockLlmProvider`: 결정적 응답(마지막 user 메시지 반영), 추정 usage
- **어댑터 (`apps/api/src/llm/providers/`)** — 공식 SDK 사용
  - Anthropic: system은 별도 파라미터, 응답은 content 블록에서 text 추출
  - OpenAI: chat.completions, system 메시지 그대로 전달
  - Gemini: systemInstruction/contents 분리, assistant → model role 매핑

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/llm` | 선택된 Provider 확인 — `{ provider, defaultModel }` |
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
- **호출 이력 비저장**: LLM 요청/응답은 DB에 저장하지 않는다 (이력화 스펙 없음).
- **소비 계층 미연결**: 기존 파이프라인(Analysis/Vision/Content Generator)을
  LLM Gateway로 갈아타는 작업은 다음 TASK 스펙 수신 시 진행.
