# Knowledge Foundation (TASK-0401, Sprint 4 — Company Brain Integration)

**회사의 공식 지식**(규칙·정책·가이드 — 예: 금지어, 필수 고지, 브랜드 가이드)을
보존하는 도메인입니다. Company Brain의 네 번째 축입니다.

```
Company Brain
 ├── SOP (표준 업무 절차 정의)      core/sop/
 ├── Decision Log (의사결정 기록)   core/decision/
 ├── Memory (기억 저장소)          core/memory/       — 프로젝트 1:N (경험)
 └── Knowledge (공식 지식)         core/knowledge/    — 회사 전역 (규칙) ← TASK-0401
Execution Layer
 └── Workflow Engine (SOP 실행)    core/workflow/
```

## Memory와의 구분 (범위 해석 — CTO_REQUEST #12)

| | Memory (TASK-0307) | Knowledge (TASK-0401) |
| --- | --- | --- |
| 성격 | 프로젝트 진행 중 얻은 **경험적 기억** | 회사 전역에 적용되는 **공식 지식/규칙** |
| 소속 | Project 1:N | **회사 전역** (projectId 없음) |
| 활용 예 | 프로젝트 맥락 회상 | READY 검증(금지어·필수 고지), 콘텐츠 가이드 |

Sprint 4 Backlog의 후속 TASK가 이 저장소를 소비합니다 —
0403 Company Brain Query Service(조회), 0404 READY Validation Engine(검증 규칙 원천).
현재는 **기반(CRUD)만** 구현하며 소비 계층은 승인 전 미착수입니다.

## 구조

- **도메인 (`packages/core/src/knowledge/`)** — 프레임워크 무관
  - `Knowledge` 엔티티: `id, title, content, category?, createdAt, updatedAt`
  - `KnowledgeRepository` **Port**: create / findById / findAll / update / delete
  - 검증: `validateCreateKnowledge` / `validateUpdateKnowledge`
    — 필수 필드(title/content) 공백 불가
- **어댑터 (`apps/api/src/knowledge/`)**
  - `PrismaKnowledgeRepository`: Repository Port의 Prisma 구현
  - `KnowledgeService`: 검증 + Repository 호출 (전역 지식이라 프로젝트 확인 없음)
  - `KnowledgeController`: CRUD API

## 필드

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | cuid |
| `title` | string | 지식 제목 (필수) |
| `content` | string | 지식 본문 (필수) |
| `category` | string? | 분류 — 자유 문자열 (예: 금지어, 필수 고지, 브랜드 가이드). Enum 고정 여부는 CTO 결정 대기 |
| `createdAt` / `updatedAt` | DateTime | 기록/개정 시각 |

## API (`/knowledge` — 회사 전역이라 최상위 경로)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/knowledge` | 생성 — `{ title, content, category? }` |
| `GET` | `/knowledge` | 목록 (최신순) |
| `GET` | `/knowledge/:knowledgeId` | 단건 |
| `PATCH` | `/knowledge/:knowledgeId` | 부분 수정 (지정한 필드만) |
| `DELETE` | `/knowledge/:knowledgeId` | 삭제 (204) |

오류: `400` 필수 필드 누락·공백, `404` 지식 없음.

## 미구현 (Sprint 4 잔여 — CTO 승인 전 착수 금지)

- TASK-0402 Structured Memory Foundation
- TASK-0403 Company Brain Query Service (SOP/Decision/Memory/Knowledge 통합 조회)
- TASK-0404 READY Validation Engine (지식 기반 검수 — CTO_REQUEST #7 연결 예상)
