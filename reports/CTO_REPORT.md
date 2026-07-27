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
| 보고 기준 TASK | **TASK-0403 — Company Brain Query Service** (+ TASK-0402 승인 결정 사항 반영) |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `7c2264a` |
| 이번 주기 | ① Memory.scope **Enum 4종 + 규칙**(`2afd089`, CTO 결정) ② 0403(`7c2264a`): CompanyBrainService + `POST /company-brain/query` |
| Sprint 4 진행 | 0401 ✅ · 0402 ✅ · **0403 ✅** · 0404 승인 대기 (착수 금지 준수) |
| 구현 중단 상태 | **TASK-0403 완료 후 즉시 중단** — CTO 승인 전 TASK-0404 미착수 |
| 스펙 확인 필요 | 통합 검색형 vs fallback형 등 → **CTO_REQUEST #14 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 154/154 통과 (core 52 · api 102) — 이번 주기 +10 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0402 승인 결정 반영 — Memory.scope Enum + 규칙 (`2afd089`)

- scope Enum 4종: `GLOBAL · COMPANY · PROJECT · PRODUCT` (DB enum + 공유 타입 + 도메인 검증)
- scope 규칙 적용: GLOBAL/COMPANY → scopeId 금지, **PROJECT → projects 실존 검증**,
  **PRODUCT → products 실존 검증** (미존재 400). value는 Json 유지
- ProjectMemory는 CTO 결정대로 **사람용 메모·작업기록 저장소**로 유지 (문서에 역할 구분 명시)
- COMPANY는 별도 엔티티가 없어 GLOBAL과 동일하게 scopeId=NULL로 해석 (CTO_REQUEST #13에 기록)

### TASK-0403 — Company Brain Query Service (`7c2264a`)

- **CompanyBrainService** (읽기 전용): 4개 저장소를 CTO 지시 순서
  **Memory → Knowledge → Decision → SOP** 로 조회, 응답은 항상 이 순서의 4개 섹션
- **`POST /company-brain/query`**: `{ query(필수), scope?, scopeId?, limit? }` —
  limit 소스별 기본 20/최대 100
- 매칭(부분 일치·대소문자 무시): Memory(key/description) · Knowledge(title/content) ·
  Decision(title/description/reason) · SOP(코드 선언 정의의 key/name/description/단계명)
- 필터: scope/scopeId는 Memory에 적용, `scope=PROJECT`면 Decision도 해당 프로젝트로 필터
- 경계 유지: Query는 **소비만** 한다 — 각 도메인의 저장·수명 관리는 해당 모듈에 유지.
  SOP는 정의(Company Brain)만 대상, 실행 이력(SopRun)은 제외
- 해석 여지(CTO_REQUEST #14): **통합 검색형**(4개 섹션 모두 반환)으로 구현 —
  우선순위 fallback형(첫 매칭 중단)이 의도라면 지시 요청
- 문서: docs/architecture/company-brain.md, README 섹션

### 누적 완료 TASK

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| Sprint 1~3 | 기반 전체 — **Sprint 3 최종 승인** (상세는 TASKS.md) | — |
| TASK-0401 | Knowledge Foundation — 승인 + category Enum | `0e028ec` · `d8e24d0` |
| TASK-0402 | Structured Memory — 승인 + scope Enum·규칙 | `ce37a80` · `2afd089` |
| **TASK-0403** | **Company Brain Query Service** | **`7c2264a`** |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — OCR 8 · Analysis 6 · Builder 6 · Status 3 · Vision 3 · Content 3 · Workflow 6 · Decision 4 · ProjectMemory 4 · Memory 5 · Knowledge 4 | 52 | ✅ |
| `apps/api` | Service+API — 기존 모듈 87 · Memory(scope 규칙 포함) 10 · **CompanyBrain 7** · Knowledge 8 → 합계 | 102 | ✅ |
| **합계** | | **154** | **전체 통과** |

신규 테스트가 검증하는 것:
- **조회 순서 고정**: 응답 섹션이 항상 MEMORY→KNOWLEDGE→DECISION→SOP
- SOP 매칭: 실제 정의(product-content)가 단계명("OCR")으로 검색됨, 미매칭 시 빈 배열
- 필터 전파: scope/scopeId → Memory where, PROJECT면 Decision where(projectId)
- 검증: 빈 query 400, Enum 외 scope 400, limit 0/101 400, limit → take 전달(기본 20)
- Memory scope 규칙: GLOBAL/COMPANY scopeId 금지, PROJECT/PRODUCT 실존 검증(미존재 400)

라이브 검증 (실 PostgreSQL, 실데이터 시드):
- `query="금지어"` → MEMORY 1(banned-words) · KNOWLEDGE 1(RULE) · DECISION 1(PROCESS) · SOP 0
- `query="OCR"` → SOP 1(product-content) — 단계명 매칭
- `scope=PROJECT+scopeId` 필터 → 해당 프로젝트 Memory만 반환
- scope 규칙: GLOBAL+scopeId 400 · PROJECT 미존재 400 · TEAM 400 · COMPANY 201
- 회귀: health / sop-runs / project-memories / 웹 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — Company Brain 소비 계층 개통 (Sprint 4 Goal 달성 축)**:

```
                    ┌─ Company Brain ────────────────────────────┐
 AI / 소비자 ──▶ CompanyBrainService (읽기 전용 Query, 0403)      │
                    │   조회 순서: Memory → Knowledge → Decision → SOP
                    ├── Memory (AI용 구조화 설정, scope Enum 4종)  │
                    ├── Knowledge (공식 지식, category Enum 8종)   │
                    ├── Decision Log (결정 이력, type Enum 8종)    │
                    ├── ProjectMemory (사람용 메모 — 보존)         │
                    └── SOP (절차 정의)                           │
 Execution Layer: Workflow Engine (SOP 실행 — Memory 사용 가능·소유 불가)
```

① AI가 Company Brain을 **한 번의 호출로 읽는 진입점**이 생김 — Sprint 4 Goal
("AI가 Company Brain을 실제 사용할 수 있는 기반")의 소비 축 개통.
② 우선순위 개념 도입: 조회 순서가 구조화 설정(Memory) 우선으로 고정.
③ 소유 경계 유지: Query는 읽기 전용, 도메인 소유권은 각 모듈에 남음.

**유지되는 핵심 결정**: Port/Adapter 도메인 계층 · 실제 AI API 미연결 원칙 · 이력 보존 모델

**현황**: 모노레포(web·api·core/shared/agents/ui), 파이프라인(업로드→OCR→분석→조립→READY→상세페이지, SOP 실행), 인프라(PostgreSQL 16·Redis 7·MinIO), 마이그레이션 15건, drift 없음

## 6. 데이터 모델

```
Project(루트) ──< Product ──< Image ──< OcrResult
      │             └──< AnalysisResult
      ├──< ProductObject (버전 관리, DRAFT⇄READY→ARCHIVED)
      ├──< Content ──▶ ProductObject
      ├──< SopRun                                        (SOP 실행 이력)
      ├──< Decision (decisionType Enum 8종)              (의사결정 로그)
      └──< ProjectMemory (title/content/source?)         (사람용 메모 — 보존)

Memory (scope Enum 4종/scopeId?/key/value Json/description?)   ((scope,scopeId,key) 유니크)
Knowledge (title/content/category Enum 8종?)                   (회사 전역 공식 지식)
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
| ProjectMemory | `POST/GET /projects/:id/memories` · `GET/PATCH/DELETE …/:memoryId` |
| Memory (표준) | `POST/GET /memory(?scope=&scopeId=)` · `GET/PATCH/DELETE /memory/:memoryId` |
| Knowledge | `POST/GET /knowledge` · `GET/PATCH/DELETE /knowledge/:knowledgeId` |
| **Company Brain** | **`POST /company-brain/query`** — 고정 순서 통합 조회 |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록/파이프라인 실행)

## 8. 리스크·기술 부채

1. **0403 해석 미확인** — 통합 검색형 vs fallback형, value 내부 검색, SopRun 포함 여부 (CTO_REQUEST #14)
2. **COMPANY scope 해석** — Company 엔티티 부재로 scopeId=NULL로 처리 (CTO_REQUEST #13에 기록)
3. **텍스트 부분 일치 검색의 한계** — 유사도(임베딩)·형태소 미지원, Memory value(Json) 내부 미검색
4. **실제 AI 모델 미연결** — 전 계층 mock 기본 (CTO_REQUEST #6)
5. **인증/권한 없음** — Company Brain 전체가 공개 API (로컬 개발 전제)

## 9. 다음 권장 사항

1. **CTO_REQUEST #14 확인** — 0403 해석(통합 검색형) 적정성
2. **TASK-0404 READY Validation Engine 스펙과 함께 승인** — 규칙 소스
   (Knowledge RULE/LEGAL·Memory 설정)와 적용 시점(READY 전이 강제 vs 별도 API)을
   #7(READY 조건 확장)과 통합해 지시 요청 (CTO_REQUEST #8)
3. Sprint 4 완료 후: SOP 실행(Workflow Engine)이 단계 실행 전 `company-brain/query`로
   컨텍스트를 조립하는 연결 — "AI가 Company Brain을 실제 사용"의 실행 측 완성 (스펙 대기)
4. **실제 Provider/Generator 연결** — mock→실모델 교체 가치 최대 (CTO_REQUEST #6)
