# AI Product Content OS

AI 기반 제품 콘텐츠 운영 시스템(Monorepo)입니다. pnpm + Turborepo로 관리됩니다.

## 프로젝트 구조

```
ai-product-content-os/
 ├─ apps/
 │   ├─ web            # Next.js (TypeScript, Tailwind CSS) — http://localhost:3000
 │   └─ api            # NestJS + Prisma — http://localhost:4000
 ├─ packages/
 │   ├─ core           # 도메인 로직 (@acos/core)
 │   ├─ shared         # 공용 타입/유틸/상수 (@acos/shared)
 │   ├─ agents         # AI 에이전트 (@acos/agents)
 │   └─ ui             # 공용 React UI 컴포넌트 (@acos/ui)
 ├─ docs               # 문서
 ├─ infrastructure     # 인프라 구성 (Docker, IaC)
 ├─ scripts            # 운영/개발 스크립트
 ├─ tests              # 통합/E2E 테스트
 ├─ docker-compose.yml # PostgreSQL, Redis, MinIO
 └─ turbo.json
```

## 요구 사항

- Node.js >= 20
- pnpm >= 10 (`corepack enable` 권장)
- Docker (PostgreSQL / Redis / MinIO 실행용)

## 시작하기

```bash
# 1. 의존성 설치
pnpm install

# 2. (선택) 인프라 실행 — PostgreSQL, Redis, MinIO
pnpm docker:up

# 3. (선택) 환경 변수 설정
cp .env.example apps/api/.env

# 4. 개발 서버 실행 (web + api 동시 실행)
pnpm dev
```

- Web: <http://localhost:3000>
- API Health: <http://localhost:4000/health> → `OK`
- MinIO Console: <http://localhost:9001> (minioadmin / minioadmin)

> DB가 실행 중이 아니어도 web/api는 정상 기동됩니다. Prisma 마이그레이션 등 DB 작업 시에만 `pnpm docker:up`이 필요합니다.

## 주요 명령어

| 명령어 | 설명 |
| --- | --- |
| `pnpm dev` | web + api + 패키지 watch 동시 실행 |
| `pnpm build` | 전체 빌드 (Turborepo 캐시 적용) |
| `pnpm lint` | 전체 린트 |
| `pnpm test` | 전체 테스트 (Jest — unit/service/API) |
| `pnpm docker:up` / `pnpm docker:down` | 인프라 기동 / 종료 |
| `pnpm prisma:generate` | Prisma Client 생성 |
| `pnpm prisma:migrate` | DB 마이그레이션 (`prisma migrate dev`) |
| `pnpm prisma:studio` | Prisma Studio 실행 |

## 사진 업로드 (TASK-0201)

- 업로드 화면: <http://localhost:3000/upload> — 드래그 앤 드롭, 다중 업로드, 진행률 표시
- 저장소: MinIO 버킷 `acos` (`images/{yyyy}/{mm}/{uuid}.{ext}` 키로 저장, public-read)
- 메타데이터: PostgreSQL `images` 테이블 (Prisma `Image` 모델)

### 업로드 API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/uploads/images` | `multipart/form-data`, 필드명 `files` (최대 10개, 파일당 10MB, jpeg/png/webp/gif) |
| `GET` | `/uploads/images?take=20` | 최근 업로드 목록 |

성공 응답(201):

```json
{
  "images": [
    {
      "id": "cml…",
      "key": "images/2026/07/….jpg",
      "url": "http://localhost:9000/acos/images/2026/07/….jpg",
      "originalName": "photo.jpg",
      "mimeType": "image/jpeg",
      "size": 123456,
      "productId": null,
      "createdAt": "2026-07-27T00:00:00.000Z"
    }
  ]
}
```

오류: `400` 파일 없음/형식 불일치, `413` 10MB 초과, `503` MinIO/DB 연결 불가.

## OCR (TASK-0202)

교체 가능한 Provider 아키텍처 위에서 이미지 텍스트를 추출합니다.
도메인(인터페이스·상태 전이·재시도)은 `@acos/core`에 있으며, 자세한 구조와
Google Vision/Azure 연결 방법은 [docs/architecture/ocr.md](docs/architecture/ocr.md) 참고.

- Provider 선택: `OCR_PROVIDER` — `mock`(기본, 실제 OCR 미연결) | `tesseract`(로컬 엔진)
- 상태: `PENDING → RUNNING → SUCCESS | FAILED`
- 실행마다 결과가 이력으로 쌓입니다 (Image : OCRResult = **1:N**)
- 실패 시 지수 백오프로 최대 `OCR_MAX_ATTEMPTS`(기본 3)회 재시도
- `confidence`(0.0~1.0), `extractedText`, Provider 원본 응답(`rawJson`) 저장

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/images/:imageId/ocr` | OCR 실행 — 새 실행 레코드 생성 (재실행 = 다시 호출) |
| `GET` | `/images/:imageId/ocr?raw=true` | 최신 결과 조회 (`raw=true`면 원본 JSON 포함) |
| `GET` | `/images/:imageId/ocr/history` | 실행 이력 (최신순) |
| `GET` | `/ocr/results?take=20` | 최근 결과 목록 |

## Product Object (TASK-0203)

OCR·Vision 결과를 조립한 **핵심 데이터 모델**입니다. 프로젝트(현재는 Product 단위)별로
버전 관리되며, 향후 상세페이지 생성의 단일 진실 공급원이 됩니다.
구조: [docs/architecture/product-object.md](docs/architecture/product-object.md) ·
스키마: [docs/schema/product-object.schema.json](docs/schema/product-object.schema.json)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects/:projectId/product-object` | OCR+Vision(mock) 조립 → 새 버전 생성 |
| `GET` | `/projects/:projectId/product-object?version=N` | 최신(또는 특정) 버전 조회 |
| `GET` | `/projects/:projectId/product-object/history` | 버전 이력 |
| `PATCH` | `/projects/:projectId/product-object/:version/status` | 상태 전이 (`DRAFT ⇄ READY`, `→ ARCHIVED`; READY는 검증 통과 필요) |

- 상태: `DRAFT → READY → ARCHIVED` · 버전: `projectId+version` 유니크, 생성마다 증가
- Vision: `VISION_PROVIDER`로 교체 가능한 Provider가 visionSummary 공급 (기본 mock,
  실패 시 null 폴백) — [docs/architecture/vision.md](docs/architecture/vision.md)

## AI 분석 (TASK-0204)

상품 이미지 + OCR 텍스트에서 구조화된 상품 정보(이름·카테고리·키워드·설명·속성·신뢰도)를
추출합니다. Provider 교체 아키텍처는 [docs/architecture/analysis.md](docs/architecture/analysis.md) 참고
(`ANALYSIS_PROVIDER=mock` 기본, 실제 AI 미연결 — Claude/OpenAI 연결 가이드 포함).

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/products/:productId/analysis` | 분석 실행. body `{ "apply": true }`면 결과를 상품 name/description에 반영 |
| `GET` | `/products/:productId/analysis?raw=true` | 최신 결과 조회 |
| `GET` | `/products/:productId/analysis/history` | 실행 이력 (최신순) |

- 상태: `PENDING → RUNNING → SUCCESS | FAILED`, Product : AnalysisResult = **1:N** 이력
- 실패 시 지수 백오프 재시도 (`ANALYSIS_MAX_ATTEMPTS`, 기본 3)

## Project (TASK-0301)

최상위 루트 엔티티입니다. 여러 상품과 Product Object 버전 이력을 묶는 작업 단위이며,
상품 생성 시 `projectId`를 지정하거나(미지정 시 자동 생성) 프로젝트를 직접 관리할 수 있습니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects` | `{ name, description? }` 프로젝트 생성 |
| `GET` | `/projects?take=20` | 목록 (상품 수·Product Object 수 포함) |
| `GET` | `/projects/:id` | 상세 (상품 목록 + 최신 Product Object 버전) |
| `PATCH` | `/projects/:id` | 수정 |
| `DELETE` | `/projects/:id` | 삭제 (상품·Product Object 함께 삭제, 이미지는 연결 해제) |

웹: `/projects`(목록) · `/projects/[id]`(파이프라인 실행 — 조립 → READY 전환 → 상세페이지 생성)

## 상세페이지 콘텐츠 (TASK-0303)

READY 상태의 Product Object를 단일 입력으로 상세페이지(Markdown)를 생성합니다.
Generator는 `CONTENT_GENERATOR`로 교체 가능(기본 mock) — [docs/architecture/content.md](docs/architecture/content.md)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects/:projectId/contents` | `{ productObjectVersion? }` — 미지정 시 최신 READY 버전 사용 |
| `GET` | `/projects/:projectId/contents` | 목록 |
| `GET` | `/projects/:projectId/contents/:contentId` | 단건 |

## SOP 실행 (TASK-0305)

SOP는 회사의 표준 업무 절차를 저장하는 도메인(Company Brain)이고,
실행은 Execution Layer의 **Workflow Engine**이 담당합니다. 기본 SOP
`product-content`는 기존 파이프라인(OCR → 조립 → READY 검수 → 상세페이지)을
한 번의 호출로 실행하며, 실행마다 단계별 결과가 이력으로 남습니다
(Project : SopRun = 1:N) — [docs/architecture/sop.md](docs/architecture/sop.md)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects/:projectId/sop-runs` | 기본 SOP 실행 → 실행 이력 반환 (단계 실패 시 `status: FAILED` 이력) |
| `GET` | `/projects/:projectId/sop-runs` | 실행 이력 목록 (최신순) |
| `GET` | `/projects/:projectId/sop-runs/:runId` | 실행 단건 조회 |

- 단계 상태: `PENDING → RUNNING → DONE | FAILED` (실패 시 이후 단계 `SKIPPED`)
- 단계 간 데이터 전달: 조립 단계의 버전이 READY 검수·상세페이지 생성에 사용됨

## Decision Log (TASK-0306)

프로젝트 진행 중 내린 의사결정(무엇을·왜)을 기록합니다. Company Brain의 일부로
SOP와 나란히 회사 지식을 축적합니다 — [docs/architecture/decision.md](docs/architecture/decision.md)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects/:projectId/decisions` | `{ title, description?, reason, decisionType, author }` 생성 |
| `GET` | `/projects/:projectId/decisions` | 목록 (최신순) |
| `GET` | `…/decisions/:decisionId` | 단건 |
| `PATCH` | `…/decisions/:decisionId` | 부분 수정 |
| `DELETE` | `…/decisions/:decisionId` | 삭제 (204) |

- `decisionType`(Enum): `ARCHITECTURE · PROCESS · PRODUCT · BUSINESS · TECHNICAL · QUALITY · SECURITY · OTHER`

오류: `400` 필수 필드(title/reason/decisionType/author) 누락·공백·Enum 외 유형, `404` 프로젝트/결정 없음.

## Memory — 표준 Structured Memory (TASK-0402)

Company Brain의 표준 Memory는 `scope / scopeId / key / value / description` 기반의
**AI용 구조화 설정 저장소**입니다. 같은 `(scope, scopeId, key)`는 한 건만 존재하며
value는 JSON입니다 — [docs/architecture/memory.md](docs/architecture/memory.md)

- `scope`(Enum): `GLOBAL · COMPANY · PROJECT · PRODUCT` — GLOBAL/COMPANY는 scopeId
  없이, PROJECT/PRODUCT는 실존하는 projectId/productId를 scopeId로 요구합니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/memory` | `{ scope, scopeId?, key, value, description? }` 저장 (중복 key 400) |
| `GET` | `/memory?scope=&scopeId=` | 목록 (필터 선택, 최신순) |
| `GET` | `/memory/:memoryId` | 단건 |
| `PATCH` | `/memory/:memoryId` | `{ value?, description? }` 수정 — scope/key는 불변 |
| `DELETE` | `/memory/:memoryId` | 삭제 (204) |

### ProjectMemory (구 Memory, TASK-0307 — 보존)

기존 프로젝트 메모형 기억은 `ProjectMemory`로 개칭해 그대로 동작합니다
(테이블 `project_memories`로 데이터 보존, API 경로 동일):
`POST/GET /projects/:projectId/memories` · `GET/PATCH/DELETE …/memories/:memoryId`

## Company Brain Query (TASK-0403)

AI가 Company Brain을 한 번에 조회하는 진입점입니다. 조회 순서는
**Memory → Knowledge → Decision → SOP** 로 고정됩니다 —
[docs/architecture/company-brain.md](docs/architecture/company-brain.md)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/company-brain/query` | `{ query, scope?, scopeId?, limit? }` → 고정 순서 4개 섹션 응답 |

## READY Validation (TASK-0404)

CompanyBrainService로 Knowledge/Memory/Decision/SOP를 읽어 READY 전환 가능
여부를 **PASS / WARNING / FAIL** 3단계로 판정합니다 (전체 판정 = 최악 값) —
[docs/architecture/ready-validation.md](docs/architecture/ready-validation.md)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects/:projectId/ready-validation` | `{ productObjectVersion? }` → 판정 + 6개 검사 상세 |

- 금지어 검사: Memory `{ scope: "GLOBAL", key: "banned-words", value: [...] }` 기반
- 검증은 판단만 — 실제 전이는 기존 `PATCH …/product-object/:version/status` 사용

## Knowledge (TASK-0401)

회사의 공식 지식(규칙·정책·가이드)을 보존합니다. 프로젝트별 경험(Memory)과 달리
**회사 전역**이며, 이후 Company Brain Query·READY 검증의 원천이 됩니다 —
[docs/architecture/knowledge.md](docs/architecture/knowledge.md)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/knowledge` | `{ title, content, category? }` 생성 |
| `GET` | `/knowledge` | 목록 (최신순) |
| `GET` | `/knowledge/:knowledgeId` | 단건 |
| `PATCH` | `/knowledge/:knowledgeId` | 부분 수정 |
| `DELETE` | `/knowledge/:knowledgeId` | 삭제 (204) |

- `category`(Enum, 선택): `RULE · POLICY · GUIDE · BRAND · LEGAL · QUALITY · FAQ · OTHER`

오류: `400` 필수 필드(title/content) 누락·공백·Enum 외 category, `404` 지식 없음.

## Product (TASK-0203)

업로드된 사진(들)을 묶어 Product Object를 생성합니다.
웹에서는 업로드 완료 후 "Product 생성" 버튼 → `/products` 목록 · `/products/[id]` 상세로 이어집니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/products` | `{ name?, description?, imageIds: string[] }` — 이미지 연결, 이름 미지정 시 OCR 첫 줄→파일명→기본값 순으로 자동 생성 |
| `GET` | `/products?take=20` | 목록 (썸네일·사진 수 포함) |
| `GET` | `/products/:id` | 상세 (이미지 + OCR 결과 포함) |
| `PATCH` | `/products/:id` | `{ name?, description? }` 수정 |
| `DELETE` | `/products/:id` | 삭제 (이미지는 연결만 해제) |

오류: `400` 잘못된 이름/존재하지 않는 이미지/이미 다른 상품에 연결된 이미지, `404` 상품 없음.

## Prisma

- 스키마: `apps/api/prisma/schema.prisma`
- 연결 문자열: `DATABASE_URL` (기본값 `postgresql://postgres:postgres@localhost:5432/acos`)

```bash
pnpm docker:up                 # PostgreSQL 기동
cp .env.example apps/api/.env  # 환경 변수 준비
pnpm prisma:migrate            # 마이그레이션 생성/적용
```
