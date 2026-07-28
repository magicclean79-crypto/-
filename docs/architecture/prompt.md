# Prompt Engine (TASK-0503, Sprint 5 — AI Execution)

**프롬프트 생성의 단일 엔진**입니다. 프롬프트 조립 로직을 각 기능에서 분리해
선언적 템플릿으로 관리하며, **향후 모든 AI 기능은 이 엔진으로만 프롬프트를
만듭니다** — LLM Gateway(호출 계층)와 짝을 이루는 프롬프트 계층입니다.

```
AI 기능 (Content Generation, 향후 Analysis/Vision/…)
   └─▶ PromptEngine.render(key, context) ─▶ LlmMessageDto[] ─▶ LLM Gateway
            │
            └─ PromptTemplate 레지스트리 (@acos/core, 프레임워크 무관)
                 └── "content-generation" — 상세페이지 생성 (TASK-0502에서 분리)
```

## 구조 (`packages/core/src/prompt/`)

- **`PromptTemplate<TInput>`**: `key`(유니크 식별자) · `name` · `description` ·
  `build(input) → LlmMessageDto[]` — 프롬프트를 **선언적 템플릿**으로 정의
- **`PromptEngine`**: 템플릿 레지스트리 + 렌더러
  - `render(key, input)` — 미등록 key는 즉시 오류 (등록 목록 안내 포함)
  - `list()` / `has(key)` — 템플릿 조회
  - 생성 시점 검증: 중복 key 오류
- **`createDefaultPromptEngine()`**: 현재 등록된 모든 템플릿을 담은 기본 엔진 —
  API의 `PROMPT_ENGINE` DI 토큰으로 제공됨 (`apps/api/src/prompt/`)

## 새 AI 기능 추가 방법 (설계 규칙)

1. `@acos/core/src/prompt/templates/`에 `PromptTemplate` 선언 (입력 컨텍스트 타입 포함)
2. `createDefaultPromptEngine()`에 등록
3. 기능 서비스는 `PROMPT_ENGINE`을 주입받아 `render("<key>", context)` →
   `LlmService.complete(...)` — **프롬프트 문자열을 서비스 안에서 직접 조립하지 않는다**

## 현재 등록된 템플릿

| key | 이름 | 입력 | 소비처 |
| --- | --- | --- | --- |
| `content-generation` | 상세페이지 생성 | `ContentGenerationContext` (READY PO + Company Brain) | ContentGenerationService (TASK-0502) |

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/prompt/templates` | 등록된 템플릿 목록 — `{ key, name, description }[]` |

## 원칙·경계

- 템플릿은 core(프레임워크 무관)에서 단위 테스트된다 — 렌더링 결과가 곧 계약
- 렌더링은 결정적이다 (같은 컨텍스트 → 같은 메시지) — LLM 호출 없이 검증 가능
- 템플릿 버전 관리·DB 저장·프리뷰 API는 스펙 없음 (CTO_REQUEST 참고)
