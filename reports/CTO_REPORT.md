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
| 보고 기준 TASK | **TASK-0306 — Decision Log Foundation** (+ TASK-0305 조건부 승인 반영) |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `a36c1b0` |
| 이번 주기 | ① 0305 아키텍처 수정(`f929977`): 실행 엔진 → **Workflow Engine** 분리 ② 0306(`a36c1b0`): Decision 엔티티 + Repository + Service + CRUD API |
| 구현 중단 상태 | **TASK-0306 완료 후 즉시 중단** — CTO 승인 전 TASK-0307 미착수 (스펙도 미수신, CTO_REQUEST #8) |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 107/107 통과 (core 38 · api 69) — 이번 주기 +12 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0305 조건부 승인 반영 — 아키텍처 수정 (`f929977`)

- CTO 지시 구조로 변경: **SOP = 표준 업무 절차 정의 도메인(Company Brain)**,
  실행 엔진은 **Workflow Engine(Execution Layer)** 으로 명칭·역할 변경
- `SopEngine` → `WorkflowEngine` (`core/sop/` → `core/workflow/`로 분리),
  실행 타입도 `Workflow*`로 개칭. SOP 정의(`SopDefinition`, `PRODUCT_CONTENT_SOP`)는
  `core/sop/`에 유지 — **로직 변경 없음, 기존 구현 재사용** (불필요한 리팩터링 없음:
  DB 모델 `SopRun`·API 경로 `/sop-runs`·공유 DTO는 그대로)
- 문서 반영: docs/architecture/sop.md, README에 2계층 구조 명시 → **TASK-0305 최종 완료**

### TASK-0306 — Decision Log Foundation (`a36c1b0`)

- **Decision 엔티티** (@acos/core `decision/`, Company Brain 소속):
  `id, title, description, reason, decisionType, author, projectId, createdAt` —
  스펙의 8개 필드 + 저장 관례로 `updatedAt` 추가(수정 시각 관찰용)
- **Repository**: `DecisionRepository` Port(@acos/core) + `PrismaDecisionRepository` 어댑터(api)
  — OCR의 Store Port와 같은 결
- **Service**: 프로젝트 존재 확인 + 도메인 검증(`validateCreateDecision`/`validateUpdateDecision`
  — 필수 필드 title/reason/decisionType/author 공백 불가) + Repository 호출
- **CRUD API**: `POST/GET /projects/:id/decisions` · `GET/PATCH/DELETE …/decisions/:decisionId`
- DB: `decisions` 테이블(Project 1:N, cascade), 마이그레이션 `20260727140000_add_decisions`
  (추가 전용, drift 없음)
- 문서: docs/architecture/decision.md, README 섹션
- 해석 여지 1건: `decisionType`은 유형 목록 스펙이 없어 자유 문자열 (CTO_REQUEST #10)

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
| TASK-0305 | SOP(정의) + Workflow Engine(실행) Foundation — 승인 반영 완료 | `5c67d54` · `f929977` |
| **TASK-0306** | **Decision Log Foundation** | **`a36c1b0`** |
| (자체정의) | AI 분석 Foundation / Product CRUD·웹 플로우 | `d49157a` / `d842338` |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — OCR 8 · Analysis 6 · Builder 6 · Status 3 · Vision 3 · Content 3 · Workflow 엔진 6 · **Decision 검증 3** | 38 | ✅ |
| `apps/api` | Service+API — OCR 8 · Analysis 9 · ProductObject 17 · Projects 10 · Contents 8 · SOP 8 · **Decisions 9** | 69 | ✅ |
| **합계** | | **107** | **전체 통과** |

신규 테스트(Decisions)가 검증하는 것:
- 생성(트림·description 기본 null), 필수 필드 누락·공백 400,
  없는 프로젝트 404, 목록 최신순, 다른 프로젝트 소속 결정 404,
  부분 수정(지정 필드만 변경·공백 400), 삭제 204 후 404
- Workflow Engine 개칭 후 기존 SOP 테스트 14건 전부 통과 (동작 불변 확인)

라이브 검증 (실 PostgreSQL, 기존 프로젝트 사용):
- Decision 생성 201 → 목록 → PATCH(부분 수정) 200 → DELETE 204 → 조회 404
- 검증 400(공백 title), 없는 프로젝트 404 — DB 반영 확인
- 회귀: health / sop-runs(이력 유지) / 웹 `/projects` 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — CTO 지시 계층 구조 확립**:

```
Company Brain
 ├── SOP (표준 업무 절차 정의)      core/sop/       ← 0305 수정: 정의 도메인으로 확정
 └── Decision Log (의사결정 기록)   core/decision/   ← 0306 신설
Execution Layer
 └── Workflow Engine (SOP 실행)    core/workflow/   ← 0305 수정: 실행 엔진 분리·개칭
```

① SOP는 더 이상 "엔진"이 아니라 Company Brain에 절차를 **저장하는 도메인**.
② Workflow Engine이 정의를 받아 실행하는 Execution Layer (로직은 기존 그대로).
③ Decision Log가 Company Brain의 두 번째 축으로 합류 — Repository Port 패턴
(OCR Store와 동일)으로 저장소 교체 가능.

**유지되는 핵심 결정**:

1. Port/Adapter 도메인 계층(@acos/core) — Provider·Repository는 교체 가능
   (`OCR_PROVIDER`, `ANALYSIS_PROVIDER`, `VISION_PROVIDER`, `CONTENT_GENERATOR`)
2. 실제 AI API 미연결 원칙 — 전 계층 mock 기본, 실연동 가이드는 docs/architecture/*.md
3. 이력 보존 모델 — OCR/Analysis/SopRun 1:N, Product Object 명시적 버전

**현황**:

- 모노레포: `apps/web`(Next.js 16, Tailwind 4) · `apps/api`(NestJS 11, Prisma 6) · `packages/{core,shared,agents,ui}`
- 파이프라인: 업로드 → OCR(1:N) → 분석(1:N) → 조립(버전) → READY 검수 → 상세페이지
  — 개별 API 또는 SOP 1회 호출(Workflow Engine)로 실행
- 인프라: docker-compose(PostgreSQL 16·Redis 7·MinIO), 마이그레이션 9건, drift 없음

## 6. 데이터 모델

```
Project(루트) ──< Product ──< Image ──< OcrResult        (1:N 이력)
      │             │           └─ MinIO 오브젝트
      │             └──< AnalysisResult                  (1:N 이력, applied 플래그)
      ├──< ProductObject (projectId+version 유니크)       (버전 관리, DRAFT⇄READY→ARCHIVED)
      ├──< Content ──(productObjectId, SetNull)──▶ ProductObject   (상세페이지, READY에서만 생성)
      ├──< SopRun (sopKey, RUNNING→DONE|FAILED, steps Json)        (SOP 실행 이력)
      └──< Decision (title/reason/decisionType/author)             (의사결정 로그, TASK-0306)
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
| **Decision Log** | **`POST/GET /projects/:id/decisions` · `GET/PATCH/DELETE …/decisions/:decisionId`** |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록) · `/projects/[id]`(파이프라인 실행)

## 8. 리스크·기술 부채

1. **decisionType 자유 문자열** — 유형 목록 스펙 부재로 enum 미고정 (CTO_REQUEST #10)
2. **실제 AI 모델 미연결** — OCR/Analysis/Vision/Content 전부 mock 기본 (CTO_REQUEST #6)
3. **SOP 동기 실행** — 요청-응답 내 순차 실행 (비동기 큐는 스펙 없어 미구현)
4. **인증/권한 없음** — 전 API 공개, Decision의 author도 자유 입력 (로컬 개발 전제)
5. Content 발행 파이프라인(REVIEW→PUBLISHED)·업로드 보안·이미지 리사이징 미구현
6. Decision Log·SOP 실행의 웹 UI 없음 — 스펙 외 확장이라 미구현

## 9. 다음 권장 사항

1. **TASK-0307 스펙 전달** — 승인 후 착수 (현재 미수신, CTO_REQUEST #8)
2. **decisionType enum 여부 결정** (CTO_REQUEST #10)
3. **실제 Provider/Generator 연결** — 파이프라인+SOP 구조 완성으로 mock→실모델 교체 가치 최대 (CTO_REQUEST #6)
4. Company Brain 활용 연결 — Decision/SOP를 콘텐츠 생성·READY 검수 규칙에 반영하는 것은
   스펙 수신 시 진행 (예: 금지어·필수 고지 검증, CTO_REQUEST #7)
