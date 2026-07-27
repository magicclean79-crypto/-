# Company Brain Query Service (TASK-0403)

AI가 Company Brain의 4개 저장소를 **한 번의 호출로 조회**하는 진입점입니다.
Sprint 4 Goal("AI가 Company Brain을 실제 사용할 수 있는 기반")의 소비 계층입니다.

## 조회 순서 (CTO 지시 — 고정)

```
Memory → Knowledge → Decision → SOP
```

응답의 섹션 배열은 항상 이 순서를 유지합니다 — AI가 컨텍스트를 조립할 때
**구조화 설정(Memory)이 최우선**, 이어서 공식 지식·결정 이력·표준 절차 순입니다.

## 구조

- `CompanyBrainService` (`apps/api/src/company-brain/`) — **읽기 전용**.
  각 도메인의 저장·수명 관리는 해당 모듈(Memory/Knowledge/Decisions/SOP)에
  남고, Query는 소비만 한다.
- SOP는 코드에 선언된 정의(`PRODUCT_CONTENT_SOP` 등)를 대상으로 하며
  실행 이력(SopRun)은 조회 대상이 아니다 (절차 정의 = Company Brain,
  실행 이력 = Execution Layer 기록).

## API

### `POST /company-brain/query`

요청:

```json
{
  "query": "금지어",            // 필수 — 검색어
  "scope": "PROJECT",          // 선택 — Memory 필터 (GLOBAL/COMPANY/PROJECT/PRODUCT)
  "scopeId": "<projectId>",    // 선택 — scope 대상. scope=PROJECT면 Decision도 이 프로젝트로 필터
  "limit": 20                  // 선택 — 소스별 최대 결과 수 (기본 20, 최대 100)
}
```

응답 (항상 4개 섹션, 고정 순서):

```json
{
  "query": "금지어",
  "results": [
    { "source": "MEMORY",    "items": [ MemoryDto... ] },
    { "source": "KNOWLEDGE", "items": [ KnowledgeDto... ] },
    { "source": "DECISION",  "items": [ DecisionDto... ] },
    { "source": "SOP",       "items": [ { "key", "name", "description", "steps": [...] } ] }
  ]
}
```

### 소스별 매칭 규칙

| 소스 | 검색 대상 (부분 일치, 대소문자 무시) | 필터 |
| --- | --- | --- |
| Memory | `key`, `description` | `scope`, `scopeId` |
| Knowledge | `title`, `content` | (회사 전역) |
| Decision | `title`, `description`, `reason` | `scope=PROJECT`일 때 `scopeId`를 projectId로 |
| SOP | 정의의 `key`, `name`, `description`, 단계 `key`/`name` | — |

오류: `400` 빈 query · Enum 외 scope · limit 범위 초과.

## 미구현 (스펙 대기)

- Memory `value`(Json) 내부 텍스트 검색, 유사도(임베딩) 검색, 페이지네이션
- TASK-0404 READY Validation Engine — 이 Query가 규칙 소스(Knowledge RULE/LEGAL,
  Memory GLOBAL 설정)를 읽는 예상 소비처 (승인 전 착수 금지)
