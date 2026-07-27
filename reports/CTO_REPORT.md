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
| 보고 기준 TASK | **TASK-0305 — SOP Engine Foundation** |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `5c67d54` |
| 파이프라인 상태 | 기존 엔드투엔드 파이프라인이 **표준 절차(SOP) 1회 호출**로 실행 가능 + 단계별 실행 이력 보존 |
| 구현 중단 상태 | **TASK-0305 완료 후 즉시 중단** — CTO 승인 전 TASK-0306/0307 미착수 (지시 준수) |
| 스펙 확인 필요 | TASK-0305는 제목만 수신되어 보수적으로 해석·구현함 → **CTO_REQUEST #9 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 95/95 통과 (core 35 · api 60) — 이번 TASK +14 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기 — TASK-0305, `5c67d54`)

- **@acos/core `sop` 도메인 신설** — 프레임워크 무관:
  - `SopDefinition`: 표준 절차의 선언적 정의 (단계 key/name 목록). 선언과 실행을 분리.
  - `SopEngine`: 순차 실행 엔진 — 단계 상태 `PENDING → RUNNING → DONE | FAILED`,
    한 단계 실패 시 이후 단계 전부 `SKIPPED`, 단계 출력은 `outputs[key]`로 다음 단계에 전달.
    생성 시점에 단계 key 중복·실행자 누락 검증.
  - 기본 SOP **`product-content`**: OCR 실행 → Product Object 조립 → READY 검수 → 상세페이지 생성
- **기존 서비스 재사용** — 단계 실행자는 `OcrService`/`ProductObjectService`/`ContentsService`를
  그대로 호출. **신규 파이프라인 로직 없음** (3개 모듈에 `exports` 추가만 변경).
- **SopRun 실행 이력 모델** — Project : SopRun = 1:N, 단계별 결과(상태/출력/오류/시각) Json 저장,
  마이그레이션 `20260727130000_add_sop_run` (추가 전용, drift 없음)
- **API**: `POST /projects/:id/sop-runs` (실행), `GET …/sop-runs` (이력 목록), `GET …/sop-runs/:runId` (단건)
- 문서: `docs/architecture/sop.md`, README SOP 섹션
- 범위 준수: 커스텀 SOP 등록·다중 SOP 선택·비동기 실행·웹 UI 버튼 등 스펙 없는 확장은
  구현하지 않음 (CTO_REQUEST #9에 기록)

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
| **TASK-0305** | **SOP Engine Foundation** | **`5c67d54`** |
| (자체정의) | AI 분석 Foundation / Product CRUD·웹 플로우 | `d49157a` / `d842338` |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — OCR 8 · Analysis 6 · Builder 6 · Status 3 · Vision 3 · Content 3 · **SOP 엔진 6** | 35 | ✅ |
| `apps/api` | Service+API — OCR 8 · Analysis 9 · ProductObject 17 · Projects 10 · Contents 8 · **SOP 8** | 60 | ✅ |
| **합계** | | **95** | **전체 통과** |

신규 테스트가 검증하는 것:
- 엔진(단위): 순차 실행·DONE, 출력 전달, 실패 시 FAILED+후속 SKIPPED,
  실행자 누락·단계 key 중복은 생성 시점 오류, 기본 SOP 4단계 선언
- 서비스/API: 4단계가 같은 Product Object 버전으로 연결(조립 v → READY v → 상세페이지 v),
  READY 검수 실패 시 FAILED 이력 저장(HTTP 오류 아님), 없는 프로젝트 404 시 이력 미생성,
  이력 목록/단건/404

라이브 검증 (실 PostgreSQL + S3 호환 스토리지, 기존 프로젝트 사용):
- `POST /projects/:id/sop-runs` → **DONE**: OCR 1/1 SUCCESS → 조립 v6 → READY 전환 → 상세페이지 생성,
  단계별 시각·출력이 이력에 기록됨
- 이력 목록/단건 200, 없는 실행·없는 프로젝트 404
- 회귀: health / contents(신규 1건 추가 확인) / product-object(v6 READY) / 웹 `/projects` 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경**: ① **선언(SopDefinition)과 실행(SopEngine/실행자 주입)의 분리** —
Provider Port/Adapter와 같은 결의 구조로, SOP 정의 교체·추가 비용이 낮다.
② SOP는 기존 서비스의 **조율 계층(orchestration)** 으로만 동작 — 도메인 로직 중복 없음.
③ 실행 이력이 5번째 1:N 이력 축(SopRun)으로 추가 — 부분 실패도 관찰 가능
(단계 실패는 HTTP 오류가 아니라 FAILED 이력으로 표현).

**유지되는 핵심 결정**:

1. Port/Adapter 도메인 계층(@acos/core) — Provider는 환경변수 1개로 교체
   (`OCR_PROVIDER`, `ANALYSIS_PROVIDER`, `VISION_PROVIDER`, `CONTENT_GENERATOR`)
2. 실제 AI API 미연결 원칙 — 전 계층 mock 기본, 실연동 가이드는 docs/architecture/*.md
3. 이력 보존 모델 — OCR/Analysis/SopRun 1:N, Product Object 명시적 버전

**현황**:

- 모노레포: `apps/web`(Next.js 16, Tailwind 4) · `apps/api`(NestJS 11, Prisma 6) · `packages/{core,shared,agents,ui}`
- 파이프라인: 업로드 → OCR(1:N) → 분석(1:N) → 조립(버전) → READY 검수 → 상세페이지
  — 개별 API 또는 **SOP 1회 호출**로 실행
- 인프라: docker-compose(PostgreSQL 16·Redis 7·MinIO), 마이그레이션 8건, drift 없음

## 6. 데이터 모델

```
Project(루트) ──< Product ──< Image ──< OcrResult        (1:N 이력)
      │             │           └─ MinIO 오브젝트
      │             └──< AnalysisResult                  (1:N 이력, applied 플래그)
      ├──< ProductObject (projectId+version 유니크)       (버전 관리, DRAFT⇄READY→ARCHIVED)
      ├──< Content ──(productObjectId, SetNull)──▶ ProductObject   (상세페이지, READY에서만 생성)
      └──< SopRun (sopKey, RUNNING→DONE|FAILED, steps Json)        (SOP 실행 이력, TASK-0305)
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
| **SOP** | **`POST/GET /projects/:id/sop-runs` · `GET …/sop-runs/:runId`** |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록) · `/projects/[id]`(파이프라인 실행)

## 8. 리스크·기술 부채

1. **TASK-0305 스펙 해석 미확인** — Contract 원문 미수신 상태의 보수적 구현 (CTO_REQUEST #8·#9)
2. **실제 AI 모델 미연결** — OCR/Analysis/Vision/Content 전부 mock 기본 (CTO_REQUEST #6)
3. **SOP 동기 실행** — 요청-응답 내 순차 실행. 이미지가 많은 프로젝트는 응답이 길어질 수 있음
   (비동기 큐 실행은 스펙 없어 미구현 — 필요 시 지시 요청)
4. **인증/권한 없음** — 전 API 공개 (로컬 개발 전제)
5. Content 발행 파이프라인(REVIEW→PUBLISHED)·업로드 보안·이미지 리사이징 미구현
6. 웹 UI에 SOP 실행 버튼 없음 — 스펙 외 확장이라 미구현 (개별 단계 버튼은 기존 유지)

## 9. 다음 권장 사항

1. **CTO_REQUEST #9 확인** — TASK-0305 해석이 Sprint Contract 정의와 일치하는지 리뷰 요청.
   불일치 시 정의 교체 비용은 낮음 (선언/실행 분리 구조)
2. **TASK-0306/0307 스펙 전달** — 승인 후 착수 (현재 승인 대기, 착수 금지 준수 중)
3. **실제 Provider/Generator 연결** — 파이프라인+SOP 구조 완성으로 mock→실모델 교체 가치 최대 (CTO_REQUEST #6)
4. 웹 UI에 SOP 실행 버튼(1클릭 파이프라인) — 승인 시 소규모 TASK로 추가 가능
