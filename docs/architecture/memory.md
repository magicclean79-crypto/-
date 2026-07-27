# Memory Engine Foundation (TASK-0307)

회사가 축적하는 **기억(지식 조각)** 을 기록·회상하는 도메인입니다.
SOP(절차)·Decision Log(결정)와 나란히 **Company Brain**을 구성합니다.

```
Company Brain
 ├── SOP (표준 업무 절차 정의)      core/sop/
 ├── Decision Log (의사결정 기록)   core/decision/
 └── Memory (기억 저장소)          core/memory/      ← TASK-0307
Execution Layer
 └── Workflow Engine (SOP 실행)    core/workflow/
```

## 소유 관계 (CTO 지시)

> **Workflow Engine은 Memory를 사용할 수 있지만 소유하지 않는다.**

- Memory의 저장·수명 관리(기록/회상/수정/삭제)는 전적으로 Company Brain
  (`MemoryEngine`)의 책임이다.
- Workflow Engine은 필요 시 `MemoryEngine`을 **주입받아 읽고 쓸 수 있을 뿐**,
  Memory 도메인을 포함하거나 관리하지 않는다 — 실행 단계와 기억의 실제 연결은
  별도 스펙 수신 시 진행한다 (현재 미연결, CTO_REQUEST 참고).

## 구조

- **도메인 (`packages/core/src/memory/`)** — 프레임워크 무관
  - `Memory` 엔티티: `id, projectId, title, content, source?, createdAt, updatedAt`
  - `MemoryStore` **Port**: create / findById / findByProjectId / update / delete
  - `MemoryEngine` 도메인 서비스: `remember`(기록, 검증+트림) · `recall`(회상, 최신순)
    · `get` · `revise`(고쳐 쓰기) · `forget`(삭제)
  - 검증: 필수 필드(title/content) 공백 불가 → `MemoryValidationError`
- **어댑터 (`apps/api/src/memories/`)**
  - `PrismaMemoryStore`: Store Port의 Prisma 구현
  - `MemoriesService`: 프로젝트 존재 확인 + Engine 호출 + HTTP 오류 매핑
  - `MemoriesController`: CRUD API

## 필드

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | cuid |
| `projectId` | string | 소속 프로젝트 (Project 1:N, 프로젝트 삭제 시 함께 삭제) |
| `title` | string | 기억 제목 (필수) |
| `content` | string | 기억 본문 (필수) |
| `source` | string? | 기억의 출처 — 예: TASK, SOP 실행, 문서 (선택) |
| `createdAt` / `updatedAt` | DateTime | 기록/수정 시각 |

## API (`/projects/:projectId/memories`)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects/:projectId/memories` | 기록 — `{ title, content, source? }` |
| `GET` | `/projects/:projectId/memories` | 회상 — 목록 (최신순) |
| `GET` | `…/memories/:memoryId` | 단건 |
| `PATCH` | `…/memories/:memoryId` | 부분 수정 (지정한 필드만) |
| `DELETE` | `…/memories/:memoryId` | 삭제 (204) |

오류: `400` 필수 필드 누락·공백, `404` 프로젝트/기억 없음
(다른 프로젝트 소속 기억 접근도 404).

## 미구현 (스펙 대기)

- Workflow Engine ↔ Memory 실제 연결 (SOP 단계에서 기억 참조/기록)
- 검색·요약·중요도 등 회상 고도화, 임베딩 기반 유사 기억 조회
