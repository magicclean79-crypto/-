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
| 보고 목적 | **Sprint 2 CTO 리뷰** |
| Sprint 2 목표 | 사진 업로드부터 Product Object 생성까지의 파이프라인 기반 구축 |
| 목표 달성 여부 | ✅ 달성 — 업로드 → OCR → (AI 분석) → Product Object 조립 전 구간 동작 |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `effe965` |
| 미착수 범위 | 상세페이지 생성, 실제 AI API 연동(전부 mock provider), Vision 실구현 |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 47/47 통과 (core 20 · api 27) |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (Sprint 2 전체)

### TASK별 산출물

| TASK | 산출물 | 커밋 |
| --- | --- | --- |
| Sprint 1 (기반) | pnpm+Turborepo 모노레포, Next.js 16(web) / NestJS 11(api), Docker Compose(PostgreSQL·Redis·MinIO), Prisma, `/health` | `4048d62` |
| TASK-0201 | 사진 업로드: 드래그 앤 드롭·다중·진행률 UI, MinIO 저장(`images/{yyyy}/{mm}/{uuid}`), `Image` 모델, 오류 처리(400/413/503) | `12bb3ae` |
| TASK-0202 | **OCR Foundation**: OCR 도메인 @acos/core 이전(Port/Adapter), `MockOCRProvider` 기본 + tesseract 선택, Image:OCRResult **1:N 이력**, 상태 PENDING/RUNNING/SUCCESS/FAILED, 재시도(지수 백오프), Jest 도입 | `4cf6882` |
| TASK-0203 | **Product Object Foundation**: `ProductObjectBuilder`(OCR+Vision mock 조립), 버전 관리 모델(projectId+version 유니크, DRAFT/READY/ARCHIVED), JSON Schema 계약, `/projects/:id/product-object` API | `de5442d` |
| (자체정의) 0204 | AI 분석 Foundation: `AnalysisProvider` 교체 구조, mock 기본, `apply` 옵션(결과→상품 반영) | `d49157a` |
| (자체정의) | Product CRUD + 업로드→상품 생성 웹 플로우(`/upload`, `/products`) | `d842338` |
| (운영) | AGENTS 협업 규칙, TASK 완료 절차, reports/ 보고 체계, TASKS.md 작업 대장 | `81aab6f`~`effe965` |

### 문서 산출물

- `docs/architecture/ocr.md` · `analysis.md` · `product-object.md` (흐름, Provider 교체 방법, 향후 연동 가이드)
- `docs/schema/product-object.schema.json` (draft 2020-12 계약)
- `reports/CTO_REPORT.md` · `CTO_REQUEST.md`, `TASKS.md`, `AGENTS.md`

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — OCR 실행/재시도 8 · Analysis 6 · ProductObjectBuilder 6 | 20 | ✅ |
| `apps/api` | Service+API(supertest) — OCR 8 · Analysis 9 · ProductObject 10 | 27 | ✅ |
| **합계** | | **47** | **전체 통과** |

라이브 검증(실 PostgreSQL + S3 호환 스토리지):
- 업로드 201 → OCR 실행(mock/tesseract 모두, tesseract는 실제 텍스트 추출 conf 0.94) → 분석 → Product Object v1/v2 생성·버전 조회·이력 확인
- Product Object 실제 응답을 JSON Schema에 대해 AJV 검증 → VALID
- 실패 경로: 손상 이미지 3회 재시도 후 FAILED(서버 생존), 400/404/413 계약 확인
- 브라우저 E2E(Playwright): 업로드 → Product 생성 → 상세 페이지 흐름

## 5. 아키텍처 변경 및 현황

**Sprint 2의 핵심 아키텍처 결정**:

1. **Port/Adapter(헥사고날) 도메인 계층** — OCR·Analysis 도메인 로직(상태 전이, 재시도)을 `@acos/core`로 이전, 프레임워크·저장소 무관. Provider는 환경변수 1개로 교체(`OCR_PROVIDER`, `ANALYSIS_PROVIDER`), 새 엔진 추가 = 인터페이스 구현 + case 1줄.
2. **실제 AI API 미연결 원칙** — 모든 Provider 기본값은 결정적 mock. Google Vision/Azure/Claude/OpenAI 연동 가이드는 문서로 준비됨.
3. **이력 보존 모델** — OCR·Analysis는 실행마다 레코드 추가(1:N), Product Object는 명시적 버전 번호(projectId+version).
4. **projectId = products.id** — Project 엔티티 부재로 기존 Product(업로드 그룹)를 프로젝트 단위로 사용. 분리 여부 CTO 결정 대기.

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
2. **Vision 미구현** — Product Object의 visionSummary는 mock (CTO_REQUEST #5)
3. **인증/권한 없음** — 전 API 공개 (로컬 개발 전제)
4. **Content 모델 미사용** — 상세페이지 TASK에서 활용 예정
5. **웹 UI 미반영 영역** — Product Object 조립/분석 실행 UI 없음
6. 업로드 보안(바이러스 검사)·이미지 리사이징 없음
7. ProductObjectStatus 전이 API(DRAFT→READY) 미구현 (CTO_REQUEST #3)

## 9. 다음 권장 사항 (Sprint 3 후보)

1. **Vision Foundation** — VisionProvider 교체 구조 + Product Object visionSummary 실연동 (기존 패턴 재사용으로 리스크 낮음)
2. **Product Object 상태 전이** — DRAFT→READY 검증 규칙 + API
3. **상세페이지(Content) 생성 파이프라인** — Product Object를 단일 입력으로 사용
4. **CTO_REQUEST 5건 결정** — 특히 Project 엔티티 분리(#1)는 이후 마이그레이션 비용이 커지기 전 조기 결정 권장
