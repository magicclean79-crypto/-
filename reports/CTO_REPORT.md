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
| 보고 기준 TASK | **TASK-0401 — Knowledge Foundation** (Sprint 4 "Company Brain Integration" 첫 TASK) |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `0e028ec` |
| Sprint 상태 | Sprint 3 **최종 승인** 완료 → Sprint 4 시작 (Backlog: 0401 완료 · 0402~0404 승인 대기) |
| 구현 중단 상태 | **TASK-0401 완료 후 즉시 중단** — CTO 승인 전 TASK-0402 이후 미착수 (진행 규칙 준수) |
| 스펙 확인 필요 | Backlog가 제목만 수신되어 보수적 구현 → **CTO_REQUEST #12 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 131/131 통과 (core 46 · api 85) — 이번 TASK +10 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기 — TASK-0401, `0e028ec`)

- **Knowledge 엔티티** (@acos/core `knowledge/`, **Company Brain 4번째 축**):
  `id, title(필수), content(필수), category?(선택·자유 문자열), createdAt, updatedAt`
- **스코프 해석 (CTO_REQUEST #12)**: Knowledge = **회사의 공식 지식**(규칙·정책·가이드 —
  예: 금지어, 필수 고지, 브랜드 가이드). Memory(프로젝트 1:N **경험**)와 구분해
  **회사 전역**(projectId 없음)으로 정의 — 이후 0403 Query Service·0404 READY
  Validation Engine이 모든 프로젝트에 적용할 수 있는 원천이 되도록
- **Repository**: `KnowledgeRepository` Port(@acos/core) + `PrismaKnowledgeRepository`
  어댑터(api) — Decision Repository·Memory Store와 동일 패턴
- **CRUD API**: `POST/GET /knowledge` · `GET/PATCH/DELETE /knowledge/:knowledgeId`
  (전역 지식이라 최상위 경로)
- DB: `knowledge` 테이블(전역, category 인덱스), 마이그레이션
  `20260727170000_add_knowledge` (추가 전용, drift 없음)
- 문서: docs/architecture/knowledge.md (Memory와의 구분 표 포함), README 섹션
- 범위 준수: **소비 계층(Query·검증) 미구현** — 0403/0404 승인 전 착수 금지 규칙 준수.
  Backlog 외 기능 없음

### 누적 완료 TASK

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| Sprint 1 | 모노레포 기반 (Next.js 16 / NestJS 11 / Docker / Prisma) | `4048d62` |
| TASK-0201~0205 | 업로드 · OCR · Product Object · Vision · (AI 분석) Foundation | `12bb3ae` 외 |
| TASK-0301~0304 | Project 루트 엔티티 · 상태 전이 · 콘텐츠 파이프라인 · 웹 UI | `55130af` 외 |
| TASK-0305 | SOP(정의) + Workflow Engine(실행) — 승인 반영 | `5c67d54` · `f929977` |
| TASK-0306 | Decision Log Foundation — 승인 + Enum 반영 | `a36c1b0` · `7864c91` |
| TASK-0307 | Memory Engine Foundation | `86cef6c` |
| **TASK-0401** | **Knowledge Foundation (Sprint 4)** | **`0e028ec`** |

(Sprint 3 전체는 CTO 최종 승인됨 — 상세 이력은 TASKS.md)

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — OCR 8 · Analysis 6 · Builder 6 · Status 3 · Vision 3 · Content 3 · Workflow 6 · Decision 4 · Memory 4 · **Knowledge 3** | 46 | ✅ |
| `apps/api` | Service+API — OCR 8 · Analysis 9 · ProductObject 17 · Projects 10 · Contents 8 · SOP 8 · Decisions 10 · Memories 8 · **Knowledge 7** | 85 | ✅ |
| **합계** | | **131** | **전체 통과** |

신규 테스트가 검증하는 것:
- 도메인 검증(단위): 필수 필드(title/content) 공백 불가, category 선택,
  수정 시 지정 필드만 검사
- Knowledge API: 생성 201(트림·category null 기본)/검증 400, 목록 최신순,
  단건/404, 부분 수정, 삭제 204 후 404

라이브 검증 (실 PostgreSQL):
- `/knowledge` 생성 201 → 목록 → 단건 200 → PATCH(category null) 200 → DELETE 204 → 404,
  검증 400 — DB 반영 확인
- 회귀: health / memories / sop-runs / 웹 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — Company Brain 4축 + 스코프 구분 도입**:

```
Company Brain
 ├── SOP (표준 업무 절차 정의)      core/sop/
 ├── Decision Log (의사결정 기록)   core/decision/    — 프로젝트 1:N
 ├── Memory (경험적 기억)          core/memory/      — 프로젝트 1:N
 └── Knowledge (공식 지식/규칙)     core/knowledge/   — 회사 전역 ← 0401 신설
Execution Layer
 └── Workflow Engine (SOP 실행)    core/workflow/
```

① Knowledge가 Company Brain의 네 번째 축으로 합류 — 절차·결정·기억에 이어 **지식**.
② **스코프 구분** 도입: 프로젝트 소속(경험: Memory/Decision) vs 회사 전역(규칙: Knowledge).
③ Sprint 4 Goal("AI가 Company Brain을 실제 사용")의 소비 계층(0403 Query, 0404 READY 검증)이
읽을 원천 데이터 저장소가 준비됨 — 소비 계층은 승인 대기.

**유지되는 핵심 결정**: Port/Adapter 도메인 계층(@acos/core) · 실제 AI API 미연결 원칙(전 계층 mock 기본) · 이력 보존 모델

**현황**: 모노레포(`apps/web`·`apps/api`·`packages/{core,shared,agents,ui}`),
파이프라인(업로드→OCR→분석→조립→READY 검수→상세페이지, SOP 1회 호출 가능),
인프라(PostgreSQL 16·Redis 7·MinIO), 마이그레이션 12건, drift 없음

## 6. 데이터 모델

```
Project(루트) ──< Product ──< Image ──< OcrResult        (1:N 이력)
      │             └──< AnalysisResult                  (1:N 이력)
      ├──< ProductObject (projectId+version 유니크)       (DRAFT⇄READY→ARCHIVED)
      ├──< Content ──▶ ProductObject                     (상세페이지, READY에서만)
      ├──< SopRun                                        (SOP 실행 이력)
      ├──< Decision (decisionType Enum 8종)              (의사결정 로그)
      └──< Memory (title/content/source?)                (경험적 기억)

Knowledge (title/content/category?)                      (회사 전역 — 프로젝트 무관, TASK-0401)
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
| Memory | `POST/GET /projects/:id/memories` · `GET/PATCH/DELETE …/:memoryId` |
| **Knowledge** | **`POST/GET /knowledge` · `GET/PATCH/DELETE /knowledge/:knowledgeId`** |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록/파이프라인 실행)

## 8. 리스크·기술 부채

1. **TASK-0401 스펙 해석 미확인** — 전역 스코프·category 자유 문자열·0402와의 경계 (CTO_REQUEST #12)
2. **Company Brain 소비 계층 부재** — Query(0403)·READY 검증(0404) 승인 대기라
   현재 Knowledge는 저장만 가능 (Sprint 4 잔여로 해소 예정)
3. **실제 AI 모델 미연결** — 전 계층 mock 기본 (CTO_REQUEST #6)
4. **인증/권한 없음** — 전역 Knowledge 수정도 공개 API (로컬 개발 전제)
5. Content 발행 파이프라인·Company Brain 웹 UI 미구현

## 9. 다음 권장 사항

1. **CTO_REQUEST #12 확인** — 전역 스코프 적정성, category Enum 고정 여부,
   0402(Structured Memory)와의 경계
2. **TASK-0402 스펙과 함께 승인** — Structured Memory Foundation의 필드·범위 스펙 전달
   요청 (CTO_REQUEST #8, 재작업 리스크 축소)
3. 0404 READY Validation Engine 스펙 수립 시 **CTO_REQUEST #7**(READY 조건 확장 —
   금지어·필수 고지)과 통합 검토 권장 — Knowledge category 설계와 직결
4. **실제 Provider/Generator 연결** — 구조 완성으로 mock→실모델 교체 가치 최대 (CTO_REQUEST #6)
