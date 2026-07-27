# CTO_REPORT — AI Product Content OS 공식 기술 보고서

> 이 문서는 AGENTS.md의 TASK 완료 절차에 따라 모든 TASK 완료 시 갱신된다.
> 형식(섹션 구성)은 항상 동일하게 유지한다:
> 1. 보고 요약 → 2. 품질 게이트 → 3. **변경 사항** → 4. **테스트 결과**
> → 5. **아키텍처 변경**(+현황) → 6. 데이터 모델 → 7. API 표면
> → 8. 리스크·기술 부채 → 9. **다음 권장 사항**
> (굵은 항목 4가지는 AGENTS.md가 요구하는 필수 포함 항목)

---

## 1. 보고 요약

| 항목 | 값 |
| --- | --- |
| 보고 기준 TASK | **TASK-0402 — Structured Memory Foundation** (+ TASK-0401 승인 결정 사항 반영) |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `ce37a80` |
| 이번 주기 | ① Knowledge.category **Enum 8종 고정**(`d8e24d0`, CTO 결정) ② 0402(`ce37a80`): 표준 Structured Memory + 기존 Memory를 ProjectMemory로 보존 |
| 구현 중단 상태 | **TASK-0402 완료 후 즉시 중단** — CTO 승인 전 TASK-0403 미착수 (진행 규칙 준수) |
| 스펙 확인 필요 | scope Enum 여부 등 세부 해석 → **CTO_REQUEST #13 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 144/144 통과 (core 50 · api 94) — 이번 주기 +13 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0401 승인 결정 반영 — Knowledge.category Enum 고정 (`d8e24d0`)

- CTO 결정 8종: `RULE · POLICY · GUIDE · BRAND · LEGAL · QUALITY · FAQ · OTHER` (선택 필드 유지)
- 3중 강제: DB `KnowledgeCategory` enum + 공유 `KNOWLEDGE_CATEGORIES` 타입 + 도메인 검증(Enum 외 값 400)
- 데이터 보존 마이그레이션(대문자 매칭, 미매칭 OTHER, NULL 유지). Knowledge 전역(Global) 관리 확정

### TASK-0402 — Structured Memory Foundation (`ce37a80`)

- **표준 Memory 재정의** (@acos/core `memory/`): 지시된 5개 필드
  `scope · scopeId · key · value · description` 기반의 **구조화 저장소**
  - `value`는 **Json** — 문자열·숫자·배열·객체 모두 저장 (구조화 취지)
  - `(scope, scopeId, key)` 조합당 1건 — DB 유니크 제약 + 서비스 중복 검사(400)
  - **수정은 value/description만** — scope/scopeId/key는 식별자라 불변
  - `scopeId`는 선택(전역 스코프는 null), scope는 자유 문자열(예: GLOBAL/PROJECT —
    Enum 고정 여부는 CTO_REQUEST #13)
- **MemoryStore Port** + `PrismaMemoryStore` 어댑터 + CRUD API:
  `POST/GET /memory(?scope=&scopeId=)` · `GET/PATCH/DELETE /memory/:memoryId`
- **기존 Memory 보존 (CTO 지시)**: `ProjectMemory`로 개칭 —
  테이블 `memories → project_memories` **이름 변경**(데이터 보존, 삭제 없음),
  도메인 `core/project-memory/`(Engine 포함), **API 경로 그대로**
  (`/projects/:id/memories`) — 기능·데이터 모두 유지, 테스트 통과
- DB: 새 `memories` 테이블(표준), 마이그레이션 `20260727190000_structured_memory`
  (rename + create, drift 없음)
- 문서: docs/architecture/memory.md 재작성(표준/보존 구분, 사용 예), README 갱신

### 누적 완료 TASK

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| Sprint 1~3 | 모노레포 · 업로드/OCR/분석/Product Object/Vision · Project 루트 · 상태 전이 · 콘텐츠 · 웹 UI · SOP+Workflow · Decision · ProjectMemory — **Sprint 3 최종 승인** | TASKS.md 참조 |
| TASK-0401 | Knowledge Foundation — 승인 + category Enum 반영 | `0e028ec` · `d8e24d0` |
| **TASK-0402** | **Structured Memory Foundation (+ ProjectMemory 보존)** | **`ce37a80`** |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — OCR 8 · Analysis 6 · Builder 6 · Status 3 · Vision 3 · Content 3 · Workflow 6 · Decision 4 · ProjectMemory 4 · **Memory(구조화) 3** · Knowledge 4 | 50 | ✅ |
| `apps/api` | Service+API — OCR 8 · Analysis 9 · ProductObject 17 · Projects 10 · Contents 8 · SOP 8 · Decisions 10 · ProjectMemories 8 · **Memory(구조화) 8** · Knowledge 8 | 94 | ✅ |
| **합계** | | **144** | **전체 통과** |

신규 테스트가 검증하는 것:
- 구조화 값 저장(객체/숫자/배열), falsy JSON 값(`false`/`0`/`null`) 허용,
  scopeId/description 기본 null, scope/key 공백·value 누락 400
- **중복 (scope, scopeId, key) 400** — 다른 범위/키는 허용
- scope/scopeId 필터 목록, 수정은 value/description만(빈 수정 400), 삭제 204 후 404
- ProjectMemory(보존): 기존 테스트 전부 유지·통과 — 기능 회귀 없음
- Knowledge category: Enum 외 값 400 (생성/수정)

라이브 검증 (실 PostgreSQL):
- `/memory`: GLOBAL(배열 값)·PROJECT(객체 값) 저장 201 → 중복 400 → 필터 목록 →
  PATCH(value 교체) 200 → 빈 PATCH 400 → DELETE 204 → 404
- **ProjectMemory 보존 확인**: `/projects/:id/memories` 생성·목록 정상 (테이블 개칭 후에도 동작)
- Knowledge: category `RULE` 201, 자유 문자열 400
- 회귀: health / sop-runs / 웹 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 표준 Memory의 구조화 전환**:

```
Company Brain
 ├── SOP (표준 업무 절차 정의)       core/sop/
 ├── Decision Log (의사결정 기록)    core/decision/       — 프로젝트 1:N, decisionType Enum
 ├── Memory (표준 구조화 저장소)     core/memory/         ← 0402: scope/key/value 재정의
 ├── ProjectMemory (메모형, 보존)    core/project-memory/ ← 구 Memory 개칭 (데이터·기능 유지)
 └── Knowledge (공식 지식)          core/knowledge/      — 전역 확정, category Enum
Execution Layer
 └── Workflow Engine (SOP 실행)     core/workflow/  — Memory 사용 가능·소유 불가
```

① 표준 Memory가 자유 텍스트 메모에서 **key-value 구조화 저장소**로 재정의 —
AI가 Company Brain을 프로그래밍 방식으로 읽고 쓸 수 있는 기반 (Sprint 4 Goal).
② scope 개념 도입으로 전역(GLOBAL)/프로젝트(PROJECT) 범위를 하나의 저장소가 수용 —
Knowledge(항상 전역)와 달리 Memory는 범위 지정형.
③ 하위 호환: 기존 구현·데이터는 ProjectMemory로 무손실 보존 (테이블 rename, API 동일).

**유지되는 핵심 결정**: Port/Adapter 도메인 계층 · 실제 AI API 미연결 원칙 · 이력 보존 모델

**현황**: 모노레포(web·api·core/shared/agents/ui), 파이프라인(업로드→OCR→분석→조립→READY→상세페이지, SOP 실행 가능), 인프라(PostgreSQL 16·Redis 7·MinIO), 마이그레이션 14건, drift 없음

## 6. 데이터 모델

```
Project(루트) ──< Product ──< Image ──< OcrResult
      │             └──< AnalysisResult
      ├──< ProductObject (버전 관리, DRAFT⇄READY→ARCHIVED)
      ├──< Content ──▶ ProductObject
      ├──< SopRun                                        (SOP 실행 이력)
      ├──< Decision (decisionType Enum 8종)              (의사결정 로그)
      └──< ProjectMemory (title/content/source?)         (메모형 기억 — 보존, 구 Memory)

Memory (scope/scopeId?/key/value Json/description?)      (표준 구조화 저장소 — (scope,scopeId,key) 유니크)
Knowledge (title/content/category Enum 8종?)             (회사 전역 공식 지식)
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| Health | `GET /health` → "OK" |
| 프로젝트 | `POST/GET /projects` · `GET/PATCH/DELETE /projects/:id` |
| 업로드 / OCR | `POST/GET /uploads/images` · `POST/GET /images/:id/ocr`(+`/history`) |
| 상품 / AI 분석 | `POST/GET /products`(+CRUD) · `POST/GET /products/:id/analysis`(+`/history`) |
| Product Object | `POST/GET /projects/:id/product-object`(+`/history`) · `PATCH …/:version/status` |
| 상세페이지 | `POST/GET /projects/:id/contents` · `GET …/:contentId` |
| SOP 실행 | `POST/GET /projects/:id/sop-runs` · `GET …/:runId` |
| Decision Log | `POST/GET /projects/:id/decisions` · `GET/PATCH/DELETE …/:decisionId` |
| ProjectMemory (보존) | `POST/GET /projects/:id/memories` · `GET/PATCH/DELETE …/:memoryId` |
| **Memory (표준)** | **`POST/GET /memory(?scope=&scopeId=)` · `GET/PATCH/DELETE /memory/:memoryId`** |
| Knowledge | `POST/GET /knowledge` · `GET/PATCH/DELETE /knowledge/:knowledgeId` |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록/파이프라인 실행)

## 8. 리스크·기술 부채

1. **scope 자유 문자열** — Enum 미고정, scopeId 실존 검증 없음 (CTO_REQUEST #13)
2. **ProjectMemory 이원화** — 표준 Memory와 메모형이 공존. 장기 정리 방침 필요 (CTO_REQUEST #13-③)
3. **Company Brain 소비 계층 부재** — Query(0403)·READY 검증(0404) 승인 대기
4. **실제 AI 모델 미연결** — 전 계층 mock 기본 (CTO_REQUEST #6)
5. **인증/권한 없음** — 전역 Memory/Knowledge 수정도 공개 API (로컬 개발 전제)

## 9. 다음 권장 사항

1. **CTO_REQUEST #13 확인** — scope Enum 고정 여부, scopeId 검증, ProjectMemory 장기 방침
2. **TASK-0403 스펙과 함께 승인** — Company Brain Query Service의 조회 범위
   (대상 도메인·쿼리·응답 형태) 스펙 전달 요청 (CTO_REQUEST #8)
3. 0404 READY Validation Engine은 Knowledge(category=RULE/LEGAL)와 Memory(GLOBAL 설정)를
   규칙 소스로 쓸 수 있는 구조가 준비됨 — 규칙 스키마 스펙 수립 시 **CTO_REQUEST #7**과 통합 검토
4. **실제 Provider/Generator 연결** — mock→실모델 교체 가치 최대 (CTO_REQUEST #6)
