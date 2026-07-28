# Content(상세페이지) 구 Generator 경로 아키텍처

**Product Object를 단일 입력**으로 상세페이지 콘텐츠를 생성하는 구 파이프라인이다
(TASK-0303). **공식 생성 엔진은 Content Generation Engine**
([content-generation.md](content-generation.md))이며, **TASK-0506에서 이 구
경로의 내부 구현이 공식 엔진으로 통합되었다** — API 계약은 그대로 유지되고,
`ContentGenerator` Port 뒤에서 `EngineContentGenerator`(Wrapper)가 공식 엔진의
생성 코어(`ContentGenerationService.generateMarkdown`)를 호출한다.

## 구성 요소

| 계층 | 구성 요소 | 위치 |
| --- | --- | --- |
| Domain (Port) | `ContentGenerator`, `ContentGenerationInput/Result` (⚠️ @deprecated — 유지) | `packages/core/src/content/content-generator.ts` |
| Adapter (Wrapper) | **`EngineContentGenerator`** — 공식 엔진 호출 (TASK-0506) | `apps/api/src/contents/engine-content.generator.ts` |
| Adapter (구 mock) | `MockContentGenerator` (⚠️ @deprecated — CTO 지시로 보존, 미연결) | `packages/core/src/content/providers/mock.generator.ts` |
| API | `ContentsController`, `ContentsService` | `apps/api/src/contents/` |

## 흐름 (TASK-0506 이후)

```
POST /projects/:projectId/contents   { productObjectVersion? }   ← ⚠️ Deprecated (계약은 유지)
        │
        ▼
ContentsService                                  ← 구 흐름 그대로
  1. Product Object 선택
       버전 지정 → 해당 버전 (READY 아니면 400)
       미지정   → 최신 READY 버전 (없으면 400)   ← 상태 전이(TASK-0302)와 연결
  2. ContentGenerator.generate(project + productObject)
        └─▶ EngineContentGenerator (Wrapper)     ← 내부 구현만 교체 (TASK-0506)
              └─▶ ContentGenerationService.generateMarkdown()
                    = Company Brain + Prompt Engine("content-generation") + LLM Gateway
  3. contents에 저장 (status=DRAFT, productObjectId 연결)
```

- **구 경로와 공식 경로(POST …/contents/generate)는 같은 Product Object에 대해
  같은 본문을 생성한다** — 생성 코어가 하나이기 때문 (통합 테스트로 검증).
- `CONTENT_GENERATOR` 환경 변수는 제거되었다 — 모델 선택은 LLM Gateway의
  `LLM_PROVIDER` 하나로 관리된다 (기본 mock).
- 콘텐츠는 **READY로 검수된 Product Object**에서만 생성된다.
- `Content.productObjectId`로 어떤 버전에서 생성됐는지 추적된다(원본 삭제 시 SetNull).

## 발행 파이프라인 (TASK-0703)

`PATCH /projects/:projectId/contents/:contentId/status` `{ status }`

```
DRAFT → REVIEW → PUBLISHED → ARCHIVED
  ↑       │
  └───────┘ (REVIEW → DRAFT 되돌리기) · DRAFT/REVIEW/PUBLISHED → ARCHIVED(종결)
```

- 전이 규칙은 @acos/core `canTransition`(Sprint 1 선언을 공식 사용) —
  위반 시 400에 가능한 전이 목록 안내, ARCHIVED는 종결(전이 불가)
- **PUBLISHED 전이는 발행 조건(`isPublishable`) 추가 검증**: REVIEW 상태 +
  제목/본문 비어 있지 않음. 전이 시 `publishedAt` 기록(이후 ARCHIVED에도 보존)
- 채널별 포맷/배포는 스펙 없음 (후속)

## 생성 로직 변경 방법

이 경로에는 더 이상 독자적인 생성 로직이 없다 — 프롬프트는
`content-generation` 템플릿([prompt.md](prompt.md)), 모델은
`LLM_PROVIDER`([llm.md](llm.md))에서 관리한다. 신규 코드는 공식 경로
(`POST …/contents/generate`)를 사용해야 하며, 구 경로는 하위 호환용이다.

## 테스트

- Unit: `packages/core/src/content/content.spec.ts` — 보존된 MockContentGenerator의
  렌더링 (참고용 유지)
- Service: `apps/api/src/contents/contents.service.spec.ts` — READY 규칙, 버전
  지정, 404, **구 경로 = 공식 경로 본문 동일성(통합 검증)**
- API: `apps/api/src/contents/contents.controller.spec.ts` — 구 계약 유지 +
  **Wrapper가 공식 엔진(generateMarkdown)을 호출하는지 검증**
