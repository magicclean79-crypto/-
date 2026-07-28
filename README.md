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
| `POST` | `/projects/:projectId/product-object` | OCR+Vision(LLM 기반) 조립 → 새 버전 생성 |
| `GET` | `/projects/:projectId/product-object?version=N` | 최신(또는 특정) 버전 조회 |
| `GET` | `/projects/:projectId/product-object/history` | 버전 이력 |
| `PATCH` | `/projects/:projectId/product-object/:version/status` | 상태 전이 (`DRAFT ⇄ READY`, `→ ARCHIVED`; READY는 검증 통과 필요) |

- 상태: `DRAFT → READY → ARCHIVED` · 버전: `projectId+version` 유니크, 생성마다 증가
- Vision: **LLM 기반 멀티모달 공식 엔진**(TASK-0505)이 visionSummary 공급 — 이미지
  바이트(base64, 최대 5장) + Prompt Engine(`vision-analysis`) + LLM Gateway +
  Company Brain 사용, 모델 선택은 `LLM_PROVIDER` 하나(기본 mock, 실패 시 null 폴백)
  — [docs/architecture/vision.md](docs/architecture/vision.md)
- **Image Guard & Preprocessing (TASK-0604)**: Vision 호출 전 검증(MIME/용량) →
  리사이즈(최대 1024px) → 최적화(JPEG q82) → **EXIF 제거** → 출력 5MB 제한 —
  위반 이미지는 스킵(분석 계속), 정책은 `VISION_IMAGE_*` 환경변수로 조정

## AI 분석 (TASK-0204 · TASK-0504에서 LLM 기반 엔진으로 교체)

상품 이미지의 OCR 텍스트 + Company Brain에서 구조화된 상품 정보(이름·카테고리·키워드·
설명·속성·신뢰도)를 추출합니다. 공식 엔진은 **Prompt Engine(`product-analysis` 템플릿) +
LLM Gateway + Company Brain**을 사용하는 `LlmAnalysisProvider`입니다 — 모델 선택은
`LLM_PROVIDER` 환경 변수 하나로 관리(기본 mock, 실제 API 미호출).
자세한 구조: [docs/architecture/analysis.md](docs/architecture/analysis.md)

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

## 상세페이지 콘텐츠 (TASK-0303 · TASK-0502 · TASK-0506 통합)

READY 상태의 Product Object를 단일 입력으로 상세페이지(Markdown)를 생성합니다.

- **엔진 경로 (TASK-0502)**: READY Product Object + **Company Brain**(지식·결정·설정·금지어) +
  **LLM Gateway**로 생성 — [docs/architecture/content-generation.md](docs/architecture/content-generation.md)
- 구 경로 (TASK-0303): **TASK-0506에서 내부가 공식 엔진으로 통합** — 계약은 유지되고
  Wrapper(EngineContentGenerator)가 같은 생성 코어를 호출, 두 경로의 본문 동일 —
  [docs/architecture/content.md](docs/architecture/content.md)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects/:projectId/contents/generate` | **공식 생성 엔진** (CTO 결정) — `{ productObjectVersion? }`, 미지정 시 최신 READY. 웹 버튼도 이 경로 사용 |
| `POST` | `/projects/:projectId/contents` | ⚠️ Deprecated — 구 경로, 내부는 공식 엔진 호출 (TASK-0506 통합 완료) |
| `GET` | `/projects/:projectId/contents` | 목록 |
| `GET` | `/projects/:projectId/contents/:contentId` | 단건 |
| `PATCH` | `/projects/:projectId/contents/:contentId/status` | **발행 파이프라인 (TASK-0703)** — `DRAFT → REVIEW → PUBLISHED → ARCHIVED`, PUBLISHED는 발행 조건 검증 + publishedAt(최초 발행 시점 보존) |
| `GET` | `/projects/:projectId/contents/:contentId/history` | **감사 이력 (TASK-0704)** — 상태 전이 기록(from→to·시각, 최신순) |

운영: **실제 Provider 스모크 테스트 (TASK-0703)** — `node scripts/real-provider-smoke.mjs`
(운영/스테이징 실키 환경 절차: [docs/operations/real-provider-smoke.md](docs/operations/real-provider-smoke.md))

## 인증/권한 (TASK-0801 Foundation · 0802 전면 쓰기 보호 · 0803 비밀번호/운영 보안 · 0804 로그인 보호)

User Entity(역할 ADMIN/EDITOR/VIEWER) · DB 세션(Bearer+httpOnly 쿠키, 7일) ·
RBAC · Actor Audit · **Login UI**(`/login`) · **사용자 관리 UI**(`/admin/users`) ·
**내 계정**(`/account`) — [docs/architecture/auth.md](docs/architecture/auth.md)

| 메서드 | 경로 | 보호 |
| --- | --- | --- |
| `POST` | `/auth/login` | 공개 — `{ email, password }` → 세션 토큰 + httpOnly 쿠키 |
| `POST` | `/auth/logout` · `GET /auth/me` | 인증 |
| `PATCH` | `/auth/password` | 인증(모든 역할) — 본인 비밀번호 변경, 다른 세션 폐기 |
| `GET/POST` | `/auth/users` · `PATCH /auth/users/:id` · `POST /auth/users/:id/password-reset` · `GET /auth/audit` | **ADMIN** — 목록/생성/역할 변경/비활성화/비밀번호 재설정 + 감사 로그 |

- **모든 쓰기 API(POST/PATCH/PUT/DELETE)는 EDITOR 이상 인증 필요** (TASK-0802,
  전역 가드). 예외: 로그인·Company Brain 조회·READY 검증(읽기 성격 @Public —
  CTO 확정, 이 3종만 유지). 조회 GET은 비보호(CTO 결정)
- **`/llm/health`는 운영/스테이징(NODE_ENV 또는 `AUTH_PROTECT_HEALTH=1`)에서
  EDITOR 이상** — 개발은 비보호 (CTO 결정 0802-③)
- **쿠키 세션(운영)**: Bearer 우선, 없으면 `acos_session` httpOnly 쿠키 인식.
  `AUTH_COOKIE_SECURE=1`(운영 필수) · `AUTH_COOKIE_SAMESITE=lax|strict|none` ·
  **`AUTH_COOKIE_ONLY`(운영 기본 켜짐 — 본문 토큰 제외, 쿠키 전용)**
- **로그인 보호 (TASK-0804)**: Rate Limit(`AUTH_LOGIN_MAX_ATTEMPTS`/`AUTH_LOGIN_WINDOW_SEC`,
  기본 30회/60초 → 429) · 계정 잠금(`AUTH_LOCKOUT_THRESHOLD`/`AUTH_LOCKOUT_MINUTES`,
  기본 5회/15분 — 재설정 시 즉시 해제) · 비밀번호 복잡도(8자+영문+숫자) ·
  실패/잠금 감사(LOGIN_FAILED/ACCOUNT_LOCKED) · 세션 TTL(`AUTH_SESSION_TTL_HOURS`, 기본 168)
- 발행 전이 수행자는 감사 이력 actor에, 사용자 관리·비밀번호
  변경/재설정은 user_audit_log에 기록
- 최초 기동 시 사용자 0명이면 관리자 자동 생성 (`AUTH_ADMIN_EMAIL`/`AUTH_ADMIN_PASSWORD`,
  기본 admin@acos.local / admin1234 — 로컬 전용)
- 스모크 스크립트는 `SMOKE_EMAIL`/`SMOKE_PASSWORD`로 로그인 후 실행

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

## Prompt Engine (TASK-0503)

프롬프트 생성의 단일 엔진입니다. 모든 AI 기능은 `@acos/core`의 PromptTemplate을
등록하고 `PromptEngine.render(key, context)`로만 프롬프트를 만듭니다 —
[docs/architecture/prompt.md](docs/architecture/prompt.md)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/prompt/templates` | 등록된 템플릿 목록 (현재: `content-generation`, `product-analysis`, `vision-analysis`) |

## LLM Gateway (TASK-0501)

모든 LLM 호출의 단일 진입점입니다. Provider는 `LLM_PROVIDER` 환경변수로 교체
(`mock` 기본 · `openai` · `anthropic` · `gemini` — **3사 전부 공식 연결**),
API 키가 없으면 항상 mock으로 동작합니다 —
[docs/architecture/llm.md](docs/architecture/llm.md)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/llm` | 선택된 Provider 확인 |
| `GET` | `/llm/health` | **Provider 상태 점검 (TASK-0603)** — 최소 실호출로 키/네트워크/모델 확인 |
| `POST` | `/llm/complete` | `{ messages, model?, maxTokens? }` → 완성 텍스트 + usage (200) |

- 키 설정: `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`
  (+ `LLM_*_MODEL`로 모델 덮어쓰기, `LLM_MAX_ATTEMPTS` 재시도)
- **OpenAI Production (TASK-0901)**: feature별 출력 상한
  `LLM_CONTENT_MAX_TOKENS`(4096) · `LLM_ANALYSIS_MAX_TOKENS`(2048) ·
  `LLM_VISION_MAX_TOKENS`(2048), JSON 잘림(finish_reason=length) 방어,
  주입 클라이언트 통합 검증. 실키 스모크 절차:
  [docs/operations/real-provider-smoke.md](docs/operations/real-provider-smoke.md)
- **Cost Governance (TASK-0902)**: `LLM_DAILY_BUDGET_USD`/`LLM_MONTHLY_BUDGET_USD`
  (UTC, 초과 시 429 차단) · 경고 임계 `LLM_BUDGET_ALERT_RATIO`(0.8) ·
  `GET /llm/budget`. **Multi-Provider Foundation**: Provider Registry
  (`GET /llm/providers`) · Model Routing `LLM_MODEL_CONTENT/ANALYSIS/VISION` ·
  웹 **`/providers`** 대시보드
- **Anthropic·Gemini 공식 연결 (TASK-0903)**: Registry 기반 **Provider
  Factory**(`provider.factory.ts` — 새 Provider는 Registry·어댑터·가격표
  3곳만 갱신) · 구조화 출력(Anthropic JSON 지시 강화 · Gemini
  `responseMimeType`) · 3사 통일 잘림 방어 · **Unified Execution**(동일
  스키마·전 Provider 비용 산정) · 웹 `/providers` **Provider 비교**
  (성공률·지연·비용·비용/호출)
- **Cross-Provider Routing (TASK-1001)**: feature별 Provider 매핑
  `LLM_ROUTE_CONTENT`/`LLM_ROUTE_ANALYSIS`/`LLM_ROUTE_VISION`
  (`provider` 또는 `provider:model`) · **호출 시점 해석(재기동 불필요)** ·
  사용 불가 Provider는 기본으로 폴백 · `GET /llm/routing` ·
  Routing Metrics(`/executions/stats`의 `byRoute`) · 웹 **`/routing`** 대시보드
- **Provider Failover (TASK-1002)**: 실행 중 실패 시 우선순위
  `LLM_FAILOVER_PRIORITY`(미설정 = 비활성)에 따라 다음 Provider로 전환 ·
  호출 제한 `LLM_TIMEOUT_MS`(기본 120000) · Provider별 재시도
  `LLM_MAX_ATTEMPTS` 소진 후 전환 · **Health Check 연동**(연속 실패
  `LLM_FAILOVER_HEALTH_THRESHOLD`회 → `LLM_FAILOVER_HEALTH_COOLDOWN_SEC`초 동안
  체인 뒤로) · `GET /llm/failover` 계측 · 웹 `/routing` 하단 표시.
  **예산 초과·요청 검증 오류는 Failover 대상이 아닙니다**(Provider를 바꿔도
  결과가 같음). 이력 Provider 필드(`AnalysisRun.provider` 등)는 실제 호출된
  Provider를 기록합니다
  - **오류 분류 (공식 표준)**: Failover 대상은 Timeout · Provider 5xx ·
    Rate Limit · 일시적 네트워크 오류. 예산 초과 · 검증 오류 · 인증(401/403) ·
    잘못된 API Key · 잘못된 요청은 대상이 아닙니다. `GET /llm/health` 진단
    호출은 운영 계측과 분리됩니다
- **Routing Experiment (TASK-1003)**: feature 트래픽을 여러 변형에 비율로
  분배 — `LLM_EXPERIMENT_CONTENT`/`LLM_EXPERIMENT_ANALYSIS`/
  `LLM_EXPERIMENT_VISION` = `이름|종류|변형=가중치,…`(미설정 = 실험 없음).
  Percentage · **A/B** · **Canary** · Weighted를 하나의 가중 추첨 원리로
  지원하고, 사용 불가 변형은 제외 후 재정규화(전부 불가 시 기존 라우팅) ·
  `GET /llm/experiments` · 변형별 지표(`/executions/stats`의 `byVariant`) ·
  웹 **`/experiments`** 대시보드(설정 비율 ↔ 실제 배정 ↔ 실행 지표 비교)
- **Sticky Assignment & Lifecycle (TASK-1101)**: **Project 기반 고정 배정** —
  같은 프로젝트는 항상 같은 변형(결정적 해시라 재기동·다중 인스턴스와 무관,
  정의가 바뀌면 재배정) · **Start / Stop / Promote / Rollback** 상태 전이
  (`POST /llm/experiments/:feature/:action`, EDITOR 이상, 전이 이력 감사) ·
  STOPPED는 기존 라우팅으로, PROMOTED는 승자 변형으로 전 트래픽 ·
  **Assignment Dashboard**(`GET /llm/experiments/assignments` + 웹
  `/experiments`) — 배정(실험 결과)과 실행(Execution)을 나란히 표시.
  권한은 **Start·Stop = EDITOR 이상 / Promote·Rollback = ADMIN 전용**이며,
  정의 변경으로 재배정이 발생하면 사유와 함께 Audit 이력이 남습니다
- **Experiment Analytics (TASK-1102)**: 변형별 성과 요약(성공률 + **Wilson
  95% 신뢰구간**·지연·비용·호출당 비용) · 기준 변형 대비 **성공률/지연/비용
  비교** · **승자 추천**(성공률 → 비용 → 지연 순, 표본이 모자라면 추천 보류) ·
  **Confidence Score**(양측 2-비율 z검정) · `GET /llm/experiments/:feature/
  analytics` + 웹 `/experiments` Analytics Dashboard.
  승격은 운영자 수동 절차이며 추천은 근거를 제공할 뿐입니다

## Execution Domain (TASK-0601, Sprint 6)

모든 LLM 호출(Content Generation · Analysis · Vision · 개발용 API)은 호출 1건당
**Execution 1건**을 기록합니다 — Provider/Model/Token/Cost(USD)/Latency/Status.
기록 실패는 호출을 실패시키지 않습니다 — [docs/architecture/execution.md](docs/architecture/execution.md)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/executions?feature=&limit=` | LLM 호출 이력 (최신순) — feature: `content-generation` `product-analysis` `vision-analysis` `dev` |
| `GET` | `/executions/stats?from=&to=` | **Dashboard 집계 (TASK-0602)** — 호출 수·성공/실패율·토큰·비용·지연을 전체 + feature/provider/model별 제공 |
| `GET` | `/executions/timeline?interval=hour\|day\|week&…` | **시간 축 집계 (TASK-0605)** — 같은 지표를 시간 버킷으로, feature/provider/model 필터 지원 |

웹: **`/executions` 실행 대시보드 (TASK-0701 · 필터 TASK-0702)** — KPI 카드(성공률은
UI에서 %) · Timeline Chart(hour/day/week, 빈 버킷 UI 보간) · **Dashboard Filter**
(Feature/Provider/Model/From/To) · Feature/Provider/Model 통계 테이블.
hour 조회는 최대 31일(CTO 결정). 웹 스모크 테스트(Playwright)가 `pnpm test`
품질 게이트에 포함됨.

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
