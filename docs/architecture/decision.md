# Decision Log Foundation (TASK-0306)

프로젝트 진행 중 내린 **의사결정(무엇을·왜)** 을 기록·보존하는 도메인입니다.
Company Brain의 일부로, SOP(표준 절차 정의)와 나란히 회사의 지식을 축적합니다.

```
Company Brain
 ├── SOP (표준 업무 절차 정의)      packages/core/src/sop/
 └── Decision Log (의사결정 기록)   packages/core/src/decision/
Execution Layer
 └── Workflow Engine (SOP 실행)    packages/core/src/workflow/
```

## 구조

- **도메인 (`packages/core/src/decision/`)** — 프레임워크 무관
  - `Decision` 엔티티: `id, projectId, title, description, reason, decisionType, author, createdAt` (+`updatedAt`)
  - `DecisionRepository` **Port**: create / findById / findByProjectId / update / delete
  - 검증 규칙: `validateCreateDecision` / `validateUpdateDecision`
    — 필수 필드(title/reason/decisionType/author) 공백 불가,
    decisionType은 Enum 값만 허용
- **어댑터 (`apps/api/src/decisions/`)**
  - `PrismaDecisionRepository`: Repository Port의 Prisma 구현
  - `DecisionsService`: 프로젝트 존재 확인 + 검증 + Repository 호출
  - `DecisionsController`: CRUD API

## 필드

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | cuid |
| `projectId` | string | 소속 프로젝트 (Project 1:N, 프로젝트 삭제 시 함께 삭제) |
| `title` | string | 결정 제목 (필수) |
| `description` | string? | 상세 설명 (선택) |
| `reason` | string | 결정의 근거 (필수) |
| `decisionType` | enum | `ARCHITECTURE · PROCESS · PRODUCT · BUSINESS · TECHNICAL · QUALITY · SECURITY · OTHER` |
| `author` | string | 결정자 (필수) |
| `createdAt` | DateTime | 기록 시각 |
| `updatedAt` | DateTime | 수정 시각 (수정 이력 관찰용 — 스펙 외 저장 관례) |

`decisionType`은 CTO 결정(TASK-0306 승인 리뷰)에 따라 **Enum으로 고정**되었습니다.
DB(`DecisionType` enum)·공유 타입(`DECISION_TYPES`)·도메인 검증 세 곳에서 강제되며,
기존 자유 문자열 데이터는 마이그레이션에서 대문자 매칭 후 미매칭 값을 `OTHER`로 이관합니다.

## API (`/projects/:projectId/decisions`)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects/:projectId/decisions` | 생성 — `{ title, description?, reason, decisionType, author }` |
| `GET` | `/projects/:projectId/decisions` | 목록 (최신순) |
| `GET` | `…/decisions/:decisionId` | 단건 |
| `PATCH` | `…/decisions/:decisionId` | 부분 수정 (지정한 필드만) |
| `DELETE` | `…/decisions/:decisionId` | 삭제 (204) |

오류: `400` 필수 필드 누락·공백, `404` 프로젝트/결정 없음
(다른 프로젝트 소속 결정 접근도 404).
