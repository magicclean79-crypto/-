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
| 보고 기준 TASK | **TASK-0307 — Memory Engine Foundation** (+ TASK-0306 승인 결정 사항 반영) |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `86cef6c` |
| 이번 주기 | ① decisionType **Enum 8종 고정**(`7864c91`, CTO 결정) ② 0307(`86cef6c`): Memory 엔티티 + MemoryEngine + Store Port + CRUD API |
| 구현 중단 상태 | **TASK-0307 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | Sprint Contract 원문 미수신 상태의 보수적 구현 → **CTO_REQUEST #11 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 121/121 통과 (core 43 · api 78) — 이번 주기 +14 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0306 승인 결정 반영 — decisionType Enum 고정 (`7864c91`)

- CTO 결정 8종으로 고정: `ARCHITECTURE · PROCESS · PRODUCT · BUSINESS · TECHNICAL · QUALITY · SECURITY · OTHER`
- 3중 강제: DB `DecisionType` enum + 공유 `DECISION_TYPES` 타입 + 도메인 검증(Enum 외 값 400)
- 데이터 보존 마이그레이션: 기존 문자열을 대문자 매칭으로 변환, 미매칭 값은 `OTHER`로 이관

### TASK-0307 — Memory Engine Foundation (`86cef6c`)

- **Memory 엔티티** (@acos/core `memory/`, **Company Brain 소속** — CTO 지시):
  `id, projectId, title, content, source?(출처), createdAt, updatedAt`
  — Contract 원문 미수신으로 Decision Log와 같은 결의 최소 필드로 정의 (CTO_REQUEST #11)
- **MemoryEngine** (도메인 서비스, 프레임워크 무관): `remember`(기록, 검증+트림) ·
  `recall`(회상, 최신순) · `get` · `revise`(고쳐 쓰기) · `forget`(삭제) —
  `MemoryStore` Port 위에서 동작, 검증 실패는 `MemoryValidationError`
- **소유 관계 (CTO 지시 반영)**: *Workflow Engine은 Memory를 사용할 수 있지만
  소유하지 않는다* — 기억의 저장·수명 관리는 전적으로 Company Brain 책임.
  실행 계층과는 **미연결** (연결 스펙 수신 시 진행), 관계는 docs에 명시
- **Repository/어댑터**: `PrismaMemoryStore`(api) — OCR Store·Decision Repository와 동일 패턴
- **CRUD API**: `POST/GET /projects/:id/memories` · `GET/PATCH/DELETE …/memories/:memoryId`
- DB: `memories` 테이블(Project 1:N, cascade), 마이그레이션 `20260727160000_add_memories`
  (추가 전용, drift 없음)
- 문서: docs/architecture/memory.md, README 섹션

### 누적 완료 TASK

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| Sprint 1 | 모노레포 기반 (Next.js 16 / NestJS 11 / Docker / Prisma) | `4048d62` |
| TASK-0201 | 사진 업로드 (MinIO, Image 모델) | `12bb3ae` |
| TASK-0202 | OCR Foundation (Provider 교체, 1:N 이력) | `4cf6882` |
| TASK-0203 | Product Object Foundation (Builder, 버전 관리, JSON Schema) | `de5442d` |
| TASK-0205 | Vision Provider Foundation | `4fb0cf4` |
| TASK-0301 | Project Domain Foundation (루트 엔티티) | `55130af` |
| TASK-0302 | Product Object 상태 전이 + READY 검증 | `9374aae` |
| TASK-0303 | 상세페이지 콘텐츠 파이프라인 | `3a7fb00` |
| TASK-0304 | 웹 UI Project/파이프라인 반영 | `0dd85bf` |
| TASK-0305 | SOP(정의) + Workflow Engine(실행) — 승인 반영 완료 | `5c67d54` · `f929977` |
| TASK-0306 | Decision Log Foundation — 승인 + Enum 반영 | `a36c1b0` · `7864c91` |
| **TASK-0307** | **Memory Engine Foundation** | **`86cef6c`** |
| (자체정의) | AI 분석 Foundation / Product CRUD·웹 플로우 | `d49157a` / `d842338` |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — OCR 8 · Analysis 6 · Builder 6 · Status 3 · Vision 3 · Content 3 · Workflow 6 · Decision 4 · **Memory 4** | 43 | ✅ |
| `apps/api` | Service+API — OCR 8 · Analysis 9 · ProductObject 17 · Projects 10 · Contents 8 · SOP 8 · Decisions 10 · **Memories 8** | 78 | ✅ |
| **합계** | | **121** | **전체 통과** |

신규 테스트가 검증하는 것:
- MemoryEngine(단위): remember 검증·트림·source null 기본, 필수 필드 공백 시
  MemoryValidationError, recall 최신순·프로젝트 격리, revise 부분 수정, forget 후 미회상
- Memories API: 기록 201/검증 400/없는 프로젝트 404, 회상 목록·단건·404,
  부분 수정, 삭제 204 후 404, 다른 프로젝트 소속 기억 404
- Decision Enum: Enum 외 값(소문자 포함) 400 — 생성/수정 모두

라이브 검증 (실 PostgreSQL, 기존 프로젝트 사용):
- Memory: 기록 201 → 회상 목록 → PATCH 200 → DELETE 204 → 404, 검증 400, 없는 프로젝트 404
- Decision Enum: `QUALITY` 201, `quality`(소문자) 400 — DB enum 반영 확인
- 회귀: health / sop-runs / 웹 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — Company Brain 3축 완성**:

```
Company Brain
 ├── SOP (표준 업무 절차 정의)      core/sop/
 ├── Decision Log (의사결정 기록)   core/decision/   ← Enum 고정
 └── Memory (기억 저장소)          core/memory/     ← 0307 신설
Execution Layer
 └── Workflow Engine (SOP 실행)    core/workflow/   — Memory를 사용 가능·소유 불가 (미연결)
```

① Memory가 Company Brain의 세 번째 축으로 합류 — 절차(SOP)·결정(Decision)·기억(Memory).
② 소유 경계 확립: Execution Layer는 Company Brain의 자산을 **사용**할 뿐 **소유**하지
않는다 (Workflow Engine ↔ Memory 관계로 명문화). ③ Store/Repository Port 패턴이
Company Brain 전반의 공통 관례로 정착 (OCR Store → Decision Repository → Memory Store).

**유지되는 핵심 결정**:

1. Port/Adapter 도메인 계층(@acos/core) — Provider·Store·Repository 교체 가능
2. 실제 AI API 미연결 원칙 — 전 계층 mock 기본, 실연동 가이드는 docs/architecture/*.md
3. 이력 보존 모델 — OCR/Analysis/SopRun 1:N, Product Object 명시적 버전

**현황**:

- 모노레포: `apps/web`(Next.js 16, Tailwind 4) · `apps/api`(NestJS 11, Prisma 6) · `packages/{core,shared,agents,ui}`
- 파이프라인: 업로드 → OCR(1:N) → 분석(1:N) → 조립(버전) → READY 검수 → 상세페이지
  — 개별 API 또는 SOP 1회 호출(Workflow Engine)로 실행
- 인프라: docker-compose(PostgreSQL 16·Redis 7·MinIO), 마이그레이션 11건, drift 없음

## 6. 데이터 모델

```
Project(루트) ──< Product ──< Image ──< OcrResult        (1:N 이력)
      │             │           └─ MinIO 오브젝트
      │             └──< AnalysisResult                  (1:N 이력, applied 플래그)
      ├──< ProductObject (projectId+version 유니크)       (버전 관리, DRAFT⇄READY→ARCHIVED)
      ├──< Content ──(productObjectId, SetNull)──▶ ProductObject   (상세페이지, READY에서만 생성)
      ├──< SopRun (sopKey, RUNNING→DONE|FAILED, steps Json)        (SOP 실행 이력)
      ├──< Decision (title/reason/decisionType[Enum 8종]/author)   (의사결정 로그)
      └──< Memory (title/content/source?)                          (기억 저장소, TASK-0307)
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| Health | `GET /health` → "OK" |
| 프로젝트 | `POST/GET /projects` · `GET/PATCH/DELETE /projects/:id` |
| 업로드 | `POST /uploads/images` · `GET /uploads/images` |
| OCR | `POST/GET /images/:id/ocr` · `GET /images/:id/ocr/history` · `GET /ocr/results` |
| 상품(프로젝트) | `POST/GET /products` · `GET/PATCH/DELETE /products/:id` |
| AI 분석 | `POST/GET /products/:id/analysis` (+`/history`, `{apply}` 옵션) |
| Product Object | `POST/GET /projects/:id/product-object` (+`?version`, `/history`) · `PATCH …/:version/status` |
| 상세페이지 | `POST/GET /projects/:id/contents` · `GET …/contents/:contentId` |
| SOP 실행 | `POST/GET /projects/:id/sop-runs` · `GET …/sop-runs/:runId` |
| Decision Log | `POST/GET /projects/:id/decisions` · `GET/PATCH/DELETE …/decisions/:decisionId` |
| **Memory** | **`POST/GET /projects/:id/memories` · `GET/PATCH/DELETE …/memories/:memoryId`** |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록) · `/projects/[id]`(파이프라인 실행)

## 8. 리스크·기술 부채

1. **TASK-0307 스펙 해석 미확인** — Contract 원문 미수신 상태의 보수적 구현 (CTO_REQUEST #8·#11)
2. **Workflow Engine ↔ Memory 미연결** — 소유 관계만 명문화, 실행 단계에서의
   기억 참조/기록은 스펙 대기
3. **실제 AI 모델 미연결** — OCR/Analysis/Vision/Content 전부 mock 기본 (CTO_REQUEST #6)
4. **인증/권한 없음** — 전 API 공개, Decision/Memory의 author·출처도 자유 입력 (로컬 개발 전제)
5. Memory 회상 고도화(검색/요약/중요도/임베딩) 미구현 — 스펙 외 확장이라 미착수
6. Content 발행 파이프라인(REVIEW→PUBLISHED)·Company Brain 웹 UI 미구현

## 9. 다음 권장 사항

1. **CTO_REQUEST #11 확인** — Memory 엔티티 필드·Engine 동작이 Contract 정의와 일치하는지 리뷰
2. **Sprint Contract 원문(또는 잔여 TASK 스펙) 전달** — 매 TASK 보수적 해석에 따른
   재작업 리스크 축소 (CTO_REQUEST #8)
3. **Workflow Engine ↔ Company Brain 연결 스펙** — SOP 실행 단계에서 Memory 기록/참조,
   Decision·Memory를 READY 검수 규칙에 반영하는 시점·규칙 (CTO_REQUEST #7과 연결)
4. **실제 Provider/Generator 연결** — 구조 완성으로 mock→실모델 교체 가치 최대 (CTO_REQUEST #6)
