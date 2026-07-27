# Memory — 표준 Structured Memory (TASK-0402) & ProjectMemory (구 TASK-0307)

Company Brain의 **표준 Memory**는 scope/key/value 기반의 **구조화 저장소**입니다
(TASK-0402, CTO 지시). 기존의 프로젝트 메모형 구현은 **ProjectMemory**로 개칭해
데이터와 기능을 보존했습니다.

```
Company Brain
 ├── SOP (표준 업무 절차 정의)       core/sop/
 ├── Decision Log (의사결정 기록)    core/decision/
 ├── Memory (표준 구조화 저장소)     core/memory/          ← TASK-0402 (표준)
 ├── ProjectMemory (메모형, 보존)    core/project-memory/  ← 구 Memory (TASK-0307)
 └── Knowledge (공식 지식)          core/knowledge/
Execution Layer
 └── Workflow Engine (SOP 실행)     core/workflow/  — Memory를 사용 가능·소유 불가
```

## 표준 Structured Memory

### 필드

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | cuid |
| `scope` | string | 적용 범위 (예: `GLOBAL`, `PROJECT` — 자유 문자열, Enum 고정 여부 CTO 결정 대기) |
| `scopeId` | string? | 범위 대상 식별자 (예: projectId). 전역 범위는 null |
| `key` | string | 범위 내 유니크 키 — `(scope, scopeId, key)` 조합이 저장 단위 |
| `value` | Json | **구조화 값** — 문자열·숫자·배열·객체·null 모두 저장 가능 |
| `description` | string? | 설명 (선택) |
| `createdAt` / `updatedAt` | DateTime | 기록/수정 시각 |

- 같은 `(scope, scopeId, key)`로는 한 건만 존재한다 (DB 유니크 + 서비스 중복 검사 400)
- **수정은 value/description만** — scope/scopeId/key는 식별자라 불변
  (변경하려면 삭제 후 재생성)

### 구조 (`packages/core/src/memory/` + `apps/api/src/memory/`)

- `Memory` 엔티티 + `MemoryStore` **Port** (create / findById / findByKey /
  findMany / update / delete) — 프레임워크 무관
- 검증: scope/key 공백 불가, value 필수(단, `false`·`0`·`null` 같은 JSON 값 허용),
  수정 시 필드 1개 이상 지정
- `PrismaMemoryStore` 어댑터 + `MemoryService` + `MemoryController`

### API (`/memory` — scope 기반이라 최상위 경로)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/memory` | 저장 — `{ scope, scopeId?, key, value, description? }` (중복 key 400) |
| `GET` | `/memory?scope=&scopeId=` | 목록 (필터 선택, 최신순) |
| `GET` | `/memory/:memoryId` | 단건 |
| `PATCH` | `/memory/:memoryId` | `{ value?, description? }` 수정 (식별자 불변) |
| `DELETE` | `/memory/:memoryId` | 삭제 (204) |

사용 예:

```json
POST /memory
{ "scope": "GLOBAL",  "key": "banned-words", "value": ["최고", "1위", "유일"] }
{ "scope": "PROJECT", "scopeId": "<projectId>", "key": "preferred-tone",
  "value": { "tone": "친근함", "emoji": false }, "description": "상세페이지 문체" }
```

## ProjectMemory (구 Memory — 보존)

TASK-0307의 프로젝트 메모형 기억은 CTO 지시("삭제하지 말고 보존")에 따라
`ProjectMemory`로 개칭해 그대로 동작합니다.

- 테이블: `memories` → `project_memories` 이름 변경 (데이터 보존 마이그레이션)
- 도메인: `core/project-memory/` — `ProjectMemoryEngine`(remember/recall/revise/forget)
- API 경로는 그대로: `POST/GET /projects/:id/memories` · `GET/PATCH/DELETE …/:memoryId`
- 신규 데이터는 표준 Structured Memory 사용 권장 (메모형이 필요한 기존 흐름만 유지)

## 소유 관계 (CTO 지시, TASK-0307에서 확립)

> **Workflow Engine은 Memory를 사용할 수 있지만 소유하지 않는다.**

실행 계층과의 실제 연결(SOP 단계에서 Memory 참조/기록)은 별도 스펙 수신 시
진행합니다 — 0403 Company Brain Query Service가 예상 소비처입니다.
