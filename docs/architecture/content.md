# Content(상세페이지) 아키텍처

**Product Object를 단일 입력**으로 상세페이지 콘텐츠를 생성하는 파이프라인이다
(TASK-0303). OCR/Analysis/Vision과 동일한 Port/Adapter 패턴을 사용하며,
**실제 생성 모델은 연결되어 있지 않다** — 기본 Generator는
`MockContentGenerator`(결정적 Markdown 렌더링)다.

## 구성 요소

| 계층 | 구성 요소 | 위치 |
| --- | --- | --- |
| Domain (Port) | `ContentGenerator`, `ContentGenerationInput/Result` | `packages/core/src/content/content-generator.ts` |
| Adapter | `MockContentGenerator`(기본) | `packages/core/src/content/providers/mock.generator.ts` |
| API | `ContentsController`, `ContentsService` | `apps/api/src/contents/` |

## 흐름

```
POST /projects/:projectId/contents   { productObjectVersion? }
        │
        ▼
ContentsService
  1. Product Object 선택
       버전 지정 → 해당 버전 (READY 아니면 400)
       미지정   → 최신 READY 버전 (없으면 400)   ← 상태 전이(TASK-0302)와 연결
  2. ContentGenerator.generate(project + productObject)
  3. contents에 저장 (status=DRAFT, productObjectId 연결)
```

- 콘텐츠는 **READY로 검수된 Product Object**에서만 생성된다.
- `Content.productObjectId`로 어떤 버전에서 생성됐는지 추적된다(원본 삭제 시 SetNull).
- Content 자체의 상태(`DRAFT → REVIEW → PUBLISHED | ARCHIVED`)는 기존
  `ContentStatus`를 사용하며 발행 파이프라인은 후속 TASK다.

## Generator 교체 방법

`CONTENT_GENERATOR` 환경 변수로 선택한다 (`apps/api/src/contents/contents.module.ts`).

1. `@acos/core`의 `ContentGenerator`를 구현한다 — Product Object 필드를 받아
   `{ title, body(Markdown), raw }`를 반환하면 된다.
2. `createContentGenerator()`에 case를 추가한다.
3. `.env`의 `CONTENT_GENERATOR`를 새 이름으로 바꾼다.

실제 모델 연결 예시는 [analysis.md](analysis.md)의 Claude structured outputs
패턴과 동일하다 — 입력이 이미지가 아니라 Product Object JSON이라는 점만 다르다.

## 테스트

- Unit: `packages/core/src/content/content.spec.ts` — Markdown 렌더링, 선택 필드 생략
- Service: `apps/api/src/contents/contents.service.spec.ts` — READY 규칙, 버전 지정, 404
- API: `apps/api/src/contents/contents.controller.spec.ts` — supertest HTTP 계약
