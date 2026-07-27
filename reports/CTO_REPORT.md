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
| 보고 기준 TASK | **TASK-0404 — READY Validation Engine** — **Sprint 4 Backlog 전체 완료** |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `817ead4` |
| Sprint 4 | Goal "Company Brain Integration" — 0401 ✅ · 0402 ✅ · 0403 ✅ · **0404 ✅** |
| 구현 중단 상태 | **완료 후 즉시 중단** — Sprint 4 종료 전 새 기능 추가 금지 준수, Sprint 리뷰 대기 |
| 스펙 확인 필요 | 검사 6종·판정 규칙, FAIL 시 전이 차단 여부 → **CTO_REQUEST #15** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 168/168 통과 (core 58 · api 110) — 이번 TASK +14 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기 — TASK-0404, `817ead4`)

- **판정 로직** (@acos/core `ready-validation/`, 프레임워크 무관):
  `evaluateReadyValidation` — 검사 6종, 전체 판정 = 최악 값
  (**PASS / WARNING / FAIL** — CTO 지시 3단계)

| # | 검사 | 근거 소스 | 규칙 |
| --- | --- | --- | --- |
| 1 | 전이 가능 | 도메인(0302) | READY 전이 불가 상태 → FAIL |
| 2 | 기본 필수 조건 | 도메인(0302) | 제목+OCR/Vision 요약 미충족 → FAIL |
| 3 | 금지어 | **Memory** | `GLOBAL/banned-words` 배열로 제목·브랜드·카테고리·OCR 텍스트 스캔 — 발견 FAIL, 미설정 WARNING |
| 4 | 관련 규칙 | **Knowledge** | 제목 검색된 RULE/LEGAL 지식 → WARNING(검토 필요) |
| 5 | 관련 결정 | **Decision** | 프로젝트 결정 참고 목록 — 정보성 PASS |
| 6 | 표준 절차 | **SOP** | product-content 정의 부재 → WARNING |

- **CompanyBrainService 사용** (CTO 지시): banned-words 조회(GLOBAL) →
  제목 검색(PROJECT 스코프 — Knowledge/Decision) → product-content 확인(SOP)
  의 3회 query 호출로 4개 소스를 읽음. 0403 산출물의 첫 실소비처
- **API**: `POST /projects/:id/ready-validation` (`{productObjectVersion?}` — 기본 최신 버전, 200)
- **경계 준수**: 판단만 수행 — 실제 READY 전이(PATCH …/status)에 결과를 강제하지 않고,
  검증 결과는 저장하지 않음 (강제·이력화 여부는 CTO_REQUEST #15). DB 변경 없음(마이그레이션 0건)
- 반영된 0403 승인 결정: 통합 조회 유지 · value 검색 다음 Sprint · SopRun 제외 (코드 변경 불요, 문서·CTO_REQUEST 정리)
- 문서: docs/architecture/ready-validation.md, README 섹션

### Sprint 4 누적 (Goal: Company Brain Integration)

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| TASK-0401 | Knowledge Foundation (+category Enum 8종) | `0e028ec` · `d8e24d0` |
| TASK-0402 | Structured Memory (+scope Enum 4종·실존 검증, ProjectMemory 보존) | `ce37a80` · `2afd089` |
| TASK-0403 | Company Brain Query Service (고정 순서 통합 조회) | `7c2264a` |
| **TASK-0404** | **READY Validation Engine (Company Brain 기반 검수 판정)** | **`817ead4`** |

(Sprint 1~3은 최종 승인 완료 — 상세 이력은 TASKS.md)

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 52 · **ReadyValidation 6** | 58 | ✅ |
| `apps/api` | Service+API — 기존 102 · **ReadyValidation 8** | 110 | ✅ |
| **합계** | | **168** | **전체 통과** |

신규 테스트가 검증하는 것:
- 판정 집계(최악 값), 6개 검사 키·순서 고정
- 금지어: 발견 FAIL(히트 단어 명시)·미설정/비배열 value WARNING·클린 PASS
- RULE/LEGAL만 WARNING(GUIDE 제외), Decision 정보성 PASS, SOP 부재 WARNING
- 전이 불가(ARCHIVED) FAIL, 필수 조건 미충족 FAIL
- CompanyBrain 호출 검증(제목 검색이 PROJECT 스코프로 수행), 404/400, 버전 지정

라이브 검증 (실 PostgreSQL, 실데이터):
- DRAFT v3 → **PASS** (6개 검사 전부 통과)
- READY v6 → **FAIL** (transition — 이미 READY라 재전이 불가, 정확한 판정)
- 금지어에 제목 단어 추가 → **FAIL** (banned-words 검출) → 원복 후 정상
- ARCHIVED v1 → **FAIL** (transition)
- 404(프로젝트/버전)·400(잘못된 버전), 회귀(query/sop-runs/웹) 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — Company Brain Integration 완성 (Sprint 4 Goal 달성)**:

```
                 ┌─ Company Brain ─────────────────────────────┐
 READY Validation Engine (0404) ──▶ CompanyBrainService (0403) │
   판정: PASS/WARNING/FAIL           │ Memory → Knowledge → Decision → SOP
   (READY 검수 근거로 소비)          ├── Memory (AI 구조화 설정, 0402)
                                     ├── Knowledge (공식 지식, 0401)
                                     ├── Decision Log · ProjectMemory · SOP
 Execution Layer: Workflow Engine (SOP 실행)
```

① **AI가 Company Brain을 실제 사용하는 첫 완결 루프**: 지식을 쌓고(0401·0402) →
조회하고(0403) → 판단에 소비한다(0404). ② 판정 로직은 core(프레임워크 무관),
데이터 수집은 api 계층 — 기존 Port/Adapter 결 유지. ③ 검증과 전이의 분리 —
검증은 조언(advisory), 전이 강제 여부는 CTO 결정 사항으로 보존.

**유지되는 핵심 결정**: Port/Adapter 도메인 계층 · 실제 AI API 미연결 원칙 · 이력 보존 모델

**현황**: 모노레포(web·api·core/shared/agents/ui), 파이프라인(업로드→OCR→분석→조립→**검증**→READY→상세페이지), 인프라(PostgreSQL 16·Redis 7·MinIO), 마이그레이션 15건, drift 없음

## 6. 데이터 모델

```
Project(루트) ──< Product ──< Image ──< OcrResult
      │             └──< AnalysisResult
      ├──< ProductObject (버전 관리, DRAFT⇄READY→ARCHIVED)
      ├──< Content ──▶ ProductObject
      ├──< SopRun · Decision(Enum 8종) · ProjectMemory

Memory (scope Enum 4종/scopeId?/key/value Json)    Knowledge (category Enum 8종?)
```

(TASK-0404는 스키마 변경 없음 — 검증 결과 비저장)

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| Health / 프로젝트 / 업로드 / OCR / 상품 / 분석 | (기존 유지 — 이전 보고 참조) |
| Product Object | `POST/GET /projects/:id/product-object`(+`/history`) · `PATCH …/:version/status` |
| 상세페이지 / SOP 실행 | `POST/GET /projects/:id/contents` · `POST/GET /projects/:id/sop-runs` |
| Decision / ProjectMemory | `…/decisions` · `…/memories` (프로젝트 스코프 CRUD) |
| Memory / Knowledge | `/memory(?scope=&scopeId=)` · `/knowledge` (CRUD) |
| Company Brain | `POST /company-brain/query` |
| **READY 검증** | **`POST /projects/:id/ready-validation`** → PASS/WARNING/FAIL + 검사 6종 |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록/파이프라인 실행)

## 8. 리스크·기술 부채

1. **0404 해석 미확인** — 검사 6종 구성, banned-words 약속 키, FAIL 시 전이 차단 여부,
   결과 이력화 (CTO_REQUEST #15)
2. **검증 미강제** — READY 전이가 검증을 우회 가능 (의도된 보수적 경계 — #15-②)
3. **텍스트 매칭 한계** — 금지어 부분 일치(오탐 가능), Knowledge 제목 검색 기반(누락 가능),
   value(Json) 검색은 다음 Sprint (CTO 결정)
4. **실제 AI 모델 미연결** — 전 계층 mock 기본 (CTO_REQUEST #6)
5. **인증/권한 없음** — Company Brain·검증 전체 공개 API (로컬 개발 전제)

## 9. 다음 권장 사항 (Sprint 5 후보)

1. **CTO_REQUEST #15 결정** — 검사 구성 승인, FAIL 시 전이 차단 통합 여부, 결과 이력화
2. **Memory value(Json) 검색 확장** — CTO 예고 사항 (다음 Sprint)
3. **SOP 실행 ↔ Company Brain 연결** — Workflow Engine의 READY 단계가
   ready-validation을 호출하도록 통합 (검수 자동화 완성)
4. **실제 Provider/Generator 연결** — Company Brain 완성으로 실모델이 참조할
   컨텍스트 기반 확보 — mock→실모델 교체 최적 시점 (CTO_REQUEST #6)
5. 웹 UI: 검증 결과(PASS/WARNING/FAIL) 표시 + Company Brain 관리 화면
