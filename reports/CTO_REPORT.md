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
| 보고 기준 TASK | TASK-0301 (Project Domain Foundation) |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `55130af` |
| 파이프라인 상태 | Project(루트) → 상품/업로드 → OCR → 분석 → Product Object 조립 — 전 구간 동작 |
| 미착수 범위 | 상세페이지 생성, 실제 AI API 연동(전 계층 mock 기본) |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 61/61 통과 (core 23 · api 38) |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

- **TASK-0301 Project Domain Foundation** (`55130af`) — Sprint 2 CTO 리뷰 승인 반영:
  - **Project 최상위 루트 엔티티 도입** — 여러 상품과 Product Object 버전 이력을 묶는 작업 단위. Projects CRUD API 5종
  - `Product.projectId` 필수화 — 생성 시 지정 가능(검증), 미지정 시 상품 이름으로 자동 생성해 **기존 업로드 웹 플로우 무파손**
  - `ProductObject.projectId`를 products.id → **projects.id로 재지정**, 조립은 프로젝트 내 **모든 상품의 이미지/OCR 집계**로 확장
  - **데이터 보존 마이그레이션**: 기존 상품 1건당 동일 id의 프로젝트 백필 → product_objects 값 재매핑 없이 FK만 교체 (데이터 손실 0, drift 0, 고아 0 검증)
  - CTO_REQUEST #1 → 결정됨 처리

### 누적 완료 TASK

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| Sprint 1 | 모노레포 기반 (Next.js 16 / NestJS 11 / Docker / Prisma) | `4048d62` |
| TASK-0201 | 사진 업로드 (MinIO, Image 모델) | `12bb3ae` |
| TASK-0202 | OCR Foundation (Provider 교체, 1:N 이력) | `4cf6882` |
| TASK-0203 | Product Object Foundation (Builder, 버전 관리, JSON Schema) | `de5442d` |
| TASK-0205 | Vision Provider Foundation | `4fb0cf4` |
| TASK-0301 | Project Domain Foundation (루트 엔티티) | `55130af` |
| (자체정의) | AI 분석 Foundation / Product CRUD·웹 플로우 | `d49157a` / `d842338` |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — OCR 8 · Analysis 6 · Builder 6 · Vision 3 | 23 | ✅ |
| `apps/api` | Service+API(supertest) — OCR 8 · Analysis 9 · ProductObject 11 · Projects 10 | 38 | ✅ |
| **합계** | | **61** | **전체 통과** |

라이브 검증(실 PostgreSQL + S3 호환 스토리지):
- 마이그레이션: 백필 프로젝트 2건, PO 이력 3건 보존 → 재조립 시 v4로 이어짐(이력 연속성)
- 신규 프로젝트 생성 → projectId 지정 상품 생성, 미지정 시 자동 프로젝트, 잘못된 projectId 400
- 회귀: health / products / analysis / ocr / 웹(홈·목록) 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경**: 도메인 루트가 Product → **Project**로 승격. Project 1:N Product, ProductObject는 Project 소유로 이동(조립 입력이 프로젝트 전체 상품으로 확장). 임시 결정이었던 "projectId=products.id"가 정식 구조로 해소됨.

**유지되는 핵심 결정**:

1. Port/Adapter 도메인 계층(@acos/core) — Provider는 환경변수 1개로 교체(`OCR_PROVIDER`, `ANALYSIS_PROVIDER`, `VISION_PROVIDER`)
2. 실제 AI API 미연결 원칙 — 전 계층 mock 기본, 실연동 가이드는 docs/architecture/*.md
3. 이력 보존 모델 — OCR/Analysis 1:N, Product Object 명시적 버전
4. ~~projectId = products.id~~ → **해소됨** (TASK-0301, Project 정식 도입)

**현황**:

- 모노레포: `apps/web`(Next.js 16, Tailwind 4) · `apps/api`(NestJS 11, Prisma 6) · `packages/{core,shared,agents,ui}`
- 파이프라인: 업로드 → OCR(1:N) → 분석(1:N) → ProductObjectBuilder → 버전 저장
- 인프라: docker-compose(PostgreSQL 16·Redis 7·MinIO), 마이그레이션 6건, drift 없음

## 6. 데이터 모델

```
Project(루트) ──< Product ──< Image ──< OcrResult        (1:N 이력)
      │             │           └─ MinIO 오브젝트
      │             ├──< AnalysisResult                  (1:N 이력, applied 플래그)
      │             └──< Content (초기 스캐폴드, 미사용)
      └──< ProductObject (projectId+version 유니크)       (버전 관리, DRAFT/READY/ARCHIVED)
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
| Product Object | `POST/GET /projects/:id/product-object` (+`?version`, `/history`) |

웹: `/`(대시보드) · `/upload`(업로드+Product 생성) · `/products`(목록) · `/products/[id]`(상세)

## 8. 리스크·기술 부채

1. **실제 AI 모델 미연결** — OCR/Analysis/Vision 전부 mock 기본 (CTO_REQUEST #6)
3. **인증/권한 없음** — 전 API 공개 (로컬 개발 전제)
4. **Content 모델 미사용** — 상세페이지 TASK에서 활용 예정
5. **웹 UI 미반영 영역** — Product Object 조립/분석 실행 UI 없음
6. 업로드 보안(바이러스 검사)·이미지 리사이징 없음
7. ProductObjectStatus 전이 API(DRAFT→READY) 미구현 (CTO_REQUEST #3)

## 9. 다음 권장 사항

1. **Product Object 상태 전이** — DRAFT→READY 검증 규칙 + API (제안 최상단)
2. **상세페이지(Content) 생성 파이프라인** — Product Object를 단일 입력으로 사용
3. **실제 Provider 연결** — 어느 계층(OCR/Analysis/Vision)부터, 어떤 모델로 할지 결정 요청 (CTO_REQUEST #6)
4. **웹 UI의 Project 반영** — 프로젝트 목록/상세 화면, 업로드 플로우에 프로젝트 선택 추가
