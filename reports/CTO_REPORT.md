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
| 보고 기준 TASK | TASK-0205 (Vision Provider Foundation) |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `4fb0cf4` |
| 파이프라인 상태 | 업로드 → OCR → 분석 → Product Object 조립 — OCR·Analysis·Vision 전 계층 Provider 교체 구조 완성 |
| 미착수 범위 | 상세페이지 생성, 실제 AI API 연동(전 계층 mock 기본) |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 51/51 통과 (core 23 · api 28) |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

- **TASK-0205 Vision Provider Foundation** (`4fb0cf4`):
  - `@acos/core`에 `VisionProvider` Port + `MockVisionProvider` — OCR/Analysis와 동일한 교체 구조, 실제 Vision 모델 미연결
  - `ProductObjectService`가 하드코딩된 mock 호출 대신 **주입된 Provider**(`VISION_PROVIDER` env, 기본 mock)를 사용
  - Vision 실패는 조립을 막지 않음 — `VISION_MAX_ATTEMPTS`(기본 3) 재시도 후 `visionSummary: null` 폴백, 제목은 OCR 첫 줄로 폴백
  - 이미지 바이트는 lazy 로더로 전달 (mock은 읽지 않음), `docs/architecture/vision.md` 신설
- 진행 근거: TASKS.md 미완료 0건 상태에서 CTO "다음" 지시 → 제안 최상단 항목 승격 (CTO_REQUEST #5 → 결정됨)

### 누적 완료 TASK

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| Sprint 1 | 모노레포 기반 (Next.js 16 / NestJS 11 / Docker / Prisma) | `4048d62` |
| TASK-0201 | 사진 업로드 (MinIO, Image 모델) | `12bb3ae` |
| TASK-0202 | OCR Foundation (Provider 교체, 1:N 이력) | `4cf6882` |
| TASK-0203 | Product Object Foundation (Builder, 버전 관리, JSON Schema) | `de5442d` |
| TASK-0205 | Vision Provider Foundation | `4fb0cf4` |
| (자체정의) | AI 분석 Foundation / Product CRUD·웹 플로우 | `d49157a` / `d842338` |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — OCR 8 · Analysis 6 · Builder 6 · Vision 3 | 23 | ✅ |
| `apps/api` | Service+API(supertest) — OCR 8 · Analysis 9 · ProductObject 11(실패 폴백 포함) | 28 | ✅ |
| **합계** | | **51** | **전체 통과** |

라이브 검증(실 PostgreSQL + S3 호환 스토리지):
- Provider 주입 경로로 Product Object v3 생성 — `visionSummary.source: "mock"`, 버전 이력 v1~v3 정상
- 회귀: health / products / product-object history / 웹 페이지 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경**: Vision 계층 신설 — Product Object 조립의 vision 공급이 하드코딩 mock 호출에서 DI 주입 Provider로 전환. **스키마/DB 변경 없음**(VisionSummary는 기존 ProductObject.visionSummary Json에 저장). 이로써 OCR·Analysis·Vision 세 AI 계층이 모두 동일한 Port/Adapter 교체 구조를 갖춤.

**유지되는 핵심 결정**:

1. Port/Adapter 도메인 계층(@acos/core) — Provider는 환경변수 1개로 교체(`OCR_PROVIDER`, `ANALYSIS_PROVIDER`, `VISION_PROVIDER`)
2. 실제 AI API 미연결 원칙 — 전 계층 mock 기본, 실연동 가이드는 docs/architecture/*.md
3. 이력 보존 모델 — OCR/Analysis 1:N, Product Object 명시적 버전
4. projectId = products.id (CTO 결정 대기)

**현황**:

- 모노레포: `apps/web`(Next.js 16, Tailwind 4) · `apps/api`(NestJS 11, Prisma 6) · `packages/{core,shared,agents,ui}`
- 파이프라인: 업로드 → OCR(1:N) → 분석(1:N) → ProductObjectBuilder → 버전 저장
- 인프라: docker-compose(PostgreSQL 16·Redis 7·MinIO), 마이그레이션 6건, drift 없음

## 6. 데이터 모델

```
Product(프로젝트 단위) ──< Image ──< OcrResult          (1:N 이력)
        │                └─ MinIO 오브젝트
        ├──< AnalysisResult                              (1:N 이력, applied 플래그)
        ├──< ProductObject (projectId+version 유니크)     (버전 관리, DRAFT/READY/ARCHIVED)
        └──< Content (초기 스캐폴드, 미사용)
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| Health | `GET /health` → "OK" |
| 업로드 | `POST /uploads/images` · `GET /uploads/images` |
| OCR | `POST/GET /images/:id/ocr` · `GET /images/:id/ocr/history` · `GET /ocr/results` |
| 상품(프로젝트) | `POST/GET /products` · `GET/PATCH/DELETE /products/:id` |
| AI 분석 | `POST/GET /products/:id/analysis` (+`/history`, `{apply}` 옵션) |
| Product Object | `POST/GET /projects/:id/product-object` (+`?version`, `/history`) |

웹: `/`(대시보드) · `/upload`(업로드+Product 생성) · `/products`(목록) · `/products/[id]`(상세)

## 8. 리스크·기술 부채

1. **Project 엔티티 부재** — CTO 결정 대기 (CTO_REQUEST #1)
2. **실제 AI 모델 미연결** — OCR/Analysis/Vision 전부 mock 기본 (CTO_REQUEST #6)
3. **인증/권한 없음** — 전 API 공개 (로컬 개발 전제)
4. **Content 모델 미사용** — 상세페이지 TASK에서 활용 예정
5. **웹 UI 미반영 영역** — Product Object 조립/분석 실행 UI 없음
6. 업로드 보안(바이러스 검사)·이미지 리사이징 없음
7. ProductObjectStatus 전이 API(DRAFT→READY) 미구현 (CTO_REQUEST #3)

## 9. 다음 권장 사항

1. **Product Object 상태 전이** — DRAFT→READY 검증 규칙 + API (제안 최상단)
2. **상세페이지(Content) 생성 파이프라인** — Product Object를 단일 입력으로 사용
3. **실제 Provider 연결** — 어느 계층(OCR/Analysis/Vision)부터, 어떤 모델로 할지 결정 요청 (CTO_REQUEST #6)
4. **Project 엔티티 분리 여부 조기 결정** (CTO_REQUEST #1) — 마이그레이션 비용 증가 전 권장
