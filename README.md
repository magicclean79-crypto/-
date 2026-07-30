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
  승격은 운영자 수동 절차이며 추천은 근거를 제공할 뿐입니다.
  최소 표본은 `LLM_EXPERIMENT_MIN_SAMPLES`(기본 30)로 조정하고, 관측 기간은
  **실험 정의가 바뀔 때만** 초기화합니다(START/STOP은 기간 유지)
- **Provider 관리 콘솔 (TASK-1201)**: Provider Enable/Disable · 모델 · 예산 ·
  실험을 **운영 중에** 조정하는 ADMIN 콘솔(웹 **`/admin/console`**).
  설정 원칙은 그대로 Code-first이고 콘솔은 그 위의 **오버라이드**입니다 —
  `유효값 = 오버라이드 ?? 환경변수 ?? 기본값`이며, 해제하면 환경변수로
  되돌아가고 화면에 각 값의 출처가 표시됩니다. 잘못된 값은 저장 시점에 400으로
  막고(마지막 Provider는 끌 수 없음), 모든 변경은 감사 이력으로 남습니다.
  `GET /admin/console` · `PUT /admin/settings/:key` · `GET /admin/audit`

## 운영 준비 (TASK-1202, Sprint 12)

배포해도 되는지를 **실제 상태로 판정**합니다 — 문서로만 있는 체크리스트는
지켜졌는지 확인할 수 없으므로, 기계가 판정할 수 있는 항목은 전부 자동화하고
사람이 봐야 하는 항목만 "직접 확인"으로 남깁니다.

- **Environment Validation**: 환경변수 선언(`packages/core/src/ops/env-spec.ts`)이
  **단일 원천** — 검증·대시보드·런북이 같은 선언을 씁니다
- **Startup Validation**: 기동 시 환경을 검증하고, **운영에서 오류가 있으면
  기동하지 않습니다**(잘못된 설정으로 뜬 서버가 더 위험). 개발에서는 경고만
- **Deployment Checklist**: 환경·DB·마이그레이션·저장소·관리자·Provider·
  예산·Failover를 자동 판정, 스모크·백업은 직접 확인
- **Health Dashboard**: 웹 **`/admin/health`** — 배포 가능 여부·차단 사유·
  구성 요소·설정 현황(비밀 값은 설정 여부만)
- **Runbook / Recovery Guide**:
  [docs/operations/production-runbook.md](docs/operations/production-runbook.md) ·
  [docs/operations/recovery-guide.md](docs/operations/recovery-guide.md)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/health` | 생존 확인 — 본문 `OK` (무인증) |
| `GET` | `/health/live` | 구조화된 생존 확인 (무인증, 내부 구성 비노출) |
| `GET` | `/health/ready` | **배포 준비 보고 (ADMIN)** — 체크리스트·구성 요소·설정 현황 |

## 실 Provider 운영 점검 (TASK-1301, Sprint 13)

실 Provider로 **실제 돈이 나가는 운영**을 시작할 때 필요한 확인입니다.
웹 화면은 **`/admin/production`**(ADMIN 전용).

- **API Key Validation**: Provider별 키 형식·조건부 필수 여부·어댑터 생성
  여부. **키 값은 노출하지 않습니다**(앞 6자 힌트와 길이만). `sk-xxxx…`·
  `changeme` 같은 **플레이스홀더를 별도 상태로** 잡습니다 — 형식 검사만으로는
  통과해 버리는 배포 사고의 단골입니다
- **Live Check**: 실제 API를 호출하므로 **기본으로 실행하지 않습니다**.
  버튼(또는 `?live=1`)으로만 실행하고, 실행 여부를 응답에 명시합니다
- **Cost Verification**: 기록된 비용을 가격표로 재계산해 대조. 가격표에 없는
  모델은 비용이 `null`로 남아 **예산 상한이 무력화되므로** 가장 먼저 드러냅니다
- **Production Monitoring**: Provider별 성공률·지연 분포(p50/p95/p99)·비용과
  경보. **표본이 적으면 판정하지 않습니다**(`unknown`) — 1회 실패로 "장애"라고
  말하지 않습니다. Health Check·Live Check 같은 **진단 호출은 관측에서
  제외**되고(제외된 수는 함께 표시), 판정 기준은 `LLM_MONITOR_*`로 조정합니다
- **Vision Production**: 이미지 전달 형식이 Provider마다 다릅니다(OpenAI
  `image_url` / Anthropic `image` block / Gemini `inlineData`). 하나만 맞으면
  Provider가 바뀌는 순간 이미지가 조용히 빠지므로 세 Provider 전부 회귀 테스트
- **Provider Smoke Test**: `scripts/real-provider-smoke.mjs` — 키가 설정된
  **모든** Provider Health Check + Vision 커버리지 + 비용·모니터링 판정

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/llm/providers/validate` | **API Key 검증 (ADMIN)** — `?live=1`이면 실호출(과금) |
| `GET` | `/llm/cost-verification` | **비용 검증 (ADMIN)** — `?hours=`(기본 24) |
| `GET` | `/llm/monitoring` | **운영 모니터링 (ADMIN)** — `?minutes=`(기본 60) |

**운영 필수 키 (CTO 결정 1202-②)**: 설정에서 참조하는 Provider의 API Key는
운영 필수입니다 — 참조하는데 키가 없으면 **서버가 기동하지 않습니다**(Fail
Fast). 쓰지 않는 Provider의 키는 없어도 됩니다.

자세한 내용: [docs/architecture/llm.md](docs/architecture/llm.md)

## 운영 자동화·경보 (TASK-1302, Sprint 13)

TASK-1301의 점검들은 **사람이 화면을 열어야** 결과를 볼 수 있었습니다.
이제 주기적으로 돌고, 문제가 생기면 **사람을 찾아갑니다**.

- **Scheduled Checks**: 비용 검증(15분) · 설정 검증(15분) · 운영 상태(1시간).
  간격은 `OPS_CHECK_*_INTERVAL`(`15m`·`1h`·`30s` 형식)로 조정하고 `off`로
  끕니다. **예약 점검은 Live Check를 하지 않습니다** — 실 키를 자동 호출하면
  과금이 사람 모르게 발생합니다
- **Alerts**: 예산 · Provider 장애 · 미산정 모델 · 설정 오류 4종.
  **같은 문제는 한 번만 알립니다**(`ALERT_COOLDOWN_MS`, 기본 30분) — 같은
  경보가 반복되면 사람이 무시하기 시작하고, 그 순간 경보 체계는 없는 것과
  같아집니다. 심각도가 올라가면 쿨다운과 무관하게 알리고, **해소도 알립니다**
- **전달 채널**: 로그(항상) + 웹훅(`ALERT_WEBHOOK_URL`). 웹훅 실패가 점검을
  실패시키지 않습니다 — 알림이 죽었다고 감지까지 멈추면 상황이 더 나빠집니다
- **CI/CD Deployment Gate**: `scripts/deployment-gate.mjs` — 파이프라인이
  `/health/ready`로 배포 가능 여부를 자동 판정합니다.
  `0` 가능 / `1` 불가 / **`2` 판정 불가**(확인하지 못한 것은 통과가 아닙니다)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/ops/alerts` | **경보 현황 (ADMIN)** — 활성·최근 경보, 예약 점검 구성 |
| `POST` | `/ops/checks/run` | **점검 수동 실행 (ADMIN)** — `?job=`으로 하나만 |

```bash
# 배포 파이프라인에서
API_BASE=https://api.example.com GATE_EMAIL=... GATE_PASSWORD=... \
  node scripts/deployment-gate.mjs || exit 1
```

## 운영 플랫폼 (TASK-1401, Sprint 14)

TASK-1302가 남긴 두 부채를 갚습니다: **예약 점검의 인스턴스별 중복 실행**과
**알림이 한 번 실패하면 아무도 모르는 채로 끝나던** 문제.

- **Distributed Scheduler / Leader Election / Lock**: 예약 실행은 Redis 잠금을
  잡은 인스턴스만 수행합니다(`REDIS_URL`). 임차는 **반드시 만료**되어(기본 30초)
  리더가 죽어도 다른 인스턴스가 인계받고, **소유자 확인 후에만** 갱신·해제해
  리더가 둘이 되지 않습니다. Redis가 없으면 단일 인스턴스 모드이며 **그 사실을
  화면에 드러냅니다**
- **Notification Center**: Slack · Email · Webhook. 채널마다 최소 심각도와 해소
  알림 여부를 따로 정합니다 — 모든 warning을 밤중에 받으면 사람이 알림을 끕니다.
  **주소는 어떤 응답에도 담지 않습니다**
- **Webhook Retry**: 지수 백오프(최대 4회). **4xx는 재시도하지 않습니다** —
  같은 요청은 같은 답을 받습니다. 모든 시도 결과를 기록해 "왜 아무도 못
  받았는가"를 추적할 수 있습니다
- **Alert History / Archive**: **삭제하지 않습니다**. 해소 후 90일이 지나면
  보관으로 옮기고, 활성 경보는 절대 보관하지 않습니다. 이력 요약은 종류별
  발생 횟수와 **평균 해소 시간**을 냅니다 — 경보가 많은 것보다 오래 방치되는
  것이 더 나쁜 신호입니다

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/ops/alerts/history` | **경보 이력 (ADMIN)** — 보관 포함·평균 해소 시간 |
| `POST` | `/ops/alerts/archive` | **보관 정리 (ADMIN)** — 삭제가 아닙니다 |
| `GET` | `/ops/notifications` | **전송 시도 이력 (ADMIN)** |
| `POST` | `/ops/notifications/test` | **채널 시험 (ADMIN)** — 실제로 전송합니다 |

**배포 게이트**: 운영에서는 `GATE_STRICT`·`GATE_ALERTS`가 **기본 ON**입니다 —
안전한 쪽이 기본이어야 사람이 잊었을 때 사고가 나지 않습니다.

## 고가용·운영 신뢰성 (TASK-1501, Sprint 15)

- **Scheduler Stopped Alert**: Redis 장애 시 **단일 모드로 자동 폴백하지
  않습니다**(폴백하면 여러 인스턴스가 동시에 점검을 돌립니다). 대신 멈춘 사실을
  critical로 알립니다. 감시자는 **잠금 없이** 돌아야 정작 알려야 할 때 알릴 수
  있고, 간격의 3배를 넘겨야 멈춘 것으로 봅니다
- **Persistent Notification Queue**: 경보를 큐에 담고 Retry Worker가 보냅니다 —
  **재시작을 견딥니다**. 워커는 리더만 돌립니다(같은 알림이 여러 번 가지 않도록)
- **Dead Letter Queue**: 4xx이거나 최대 시도를 소진하면 `DEAD`로 남기고
  **지우지 않습니다**. 설정을 고친 뒤 `requeue`로 다시 보냅니다
- **Alert Archive 예약화**: 네 번째 예약 점검으로 편입되어 **매일 04:00**(운영
  서버 로컬 시각, `TZ`)에 돕니다. 그 시각 전에는 한 번도 안 돌았어도 돌지 않습니다
- **운영 기본 채널 정책**: Slack Warning 이상 / **Email Critical 이상** /
  Webhook Warning 이상 / 해소 포함 — 메일은 쌓이면 읽지 않게 되기 때문입니다.
  환경변수로 전부 변경 가능합니다

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/ops/notifications/queue` | **큐 현황 (ADMIN)** — 대기·성공·Dead Letter |
| `POST` | `/ops/notifications/queue/drain` | **지금 보내기 (ADMIN)** |
| `POST` | `/ops/notifications/queue/requeue` | **Dead Letter 재시도 (ADMIN)** |

## 운영 검증·재해 복구 (TASK-1601, Sprint 16)

"잘 돌고 있는가"(`/admin/production`)와 별개로, **"지금 무너지면 되살릴 수
있는가"** 를 판정하는 화면입니다 — 웹 **`/admin/operations`**(ADMIN 전용).
절차는 [docs/operations/disaster-recovery.md](docs/operations/disaster-recovery.md).

- **Real SMTP Validation**: 실제 SMTP에 연결·인증까지 확인합니다.
  **메일은 보내지 않습니다** — 점검이 수신함을 채우면 사람이 무시하게 됩니다.
  미설정은 실패가 아니라 **미구성**으로 알립니다
- **Backup Automation**: `pg_dump --format=custom`을 매일 **03:00**(로컬)에
  받고 **크기를 기록**합니다 — 1KB 미만은 빈 덤프로 보고 실패로 셉니다.
  보존 기간이 지나도 **최근 3개는 남깁니다**
- **Restore Verification**: 매일 **03:30**(로컬)에 최신 덤프를 **별도
  DB**(`BACKUP_RESTORE_DB_URL`)에 복원하고 테이블 수를 셉니다. 운영 DB에는 절대
  복원하지 않습니다. **복원해 보지 않은 백업은 백업이 아닙니다** — 이력이 없으면
  `missing`이고, 그것은 통과가 아닙니다
- **Disaster Recovery Checklist**: 백업·복원·DB·저장소가 복구를 좌우하는
  항목이고, Redis·경보 채널은 아닙니다. 복구 절차 숙지·연락 체계는 자동 판정이
  불가능하므로 **`직접 확인`으로 남깁니다**
- **Provider Smoke Automation**: 예약 자리는 있지만 **기본은 꺼져 있습니다** —
  실제 과금되기 때문입니다. "지금 점검"도 **꺼진 작업은 건너뜁니다**
- **Redis Health**: Redis가 죽어도 **LLM 호출은 계속됩니다**. 예약 점검만
  멈추고, 30분 이상 지속되면 Critical 경보가 반복됩니다

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/ops/readiness` | **운영 대시보드 (ADMIN)** |
| `POST` | `/ops/backup/run` | **지금 백업 (ADMIN)** |
| `POST` | `/ops/backup/verify-restore` | **지금 복원 검증 (ADMIN)** |
| `POST` | `/ops/notifications/verify-smtp` | **메일 경로 확인 (ADMIN)** |

## Enterprise 거버넌스 자동화 (TASK-2701, Sprint 27)

CTO 결정 2601-①~⑤ 반영 — 주제는 **사람이 누르지 않아도 도는 거버넌스**입니다.
TASK-2601이 스캔 도구를 만들었고, 이번에는 그것을 **예약으로 돌리고, 늘었을
때만 부르고, 큰 프로젝트에서도 정확하게** 만들었습니다.

- **이미 나간 위반의 공식 절차**(결정 2601-①): **`PUBLISHED` → `ARCHIVED` →
  수정 → 재발행**. 그런데 `ARCHIVED`는 종결 상태여서 그 절차를 밟을 수
  없었습니다 — **`ARCHIVED` → `DRAFT` 되살리기를 열었습니다.** 절차를 정해
  두고 코드가 막고 있으면 사람은 새 콘텐츠를 만들어 우회하고, 그러면 왜
  내렸는지가 새 콘텐츠에 남지 않습니다. **발행으로 직행하는 길은 열지
  않았습니다** — 되살린 것은 `REVIEW`를 거쳐야 하고, 그래야 **게이트가 다시
  돕니다.** 별도 상태(`SUSPENDED`)는 만들지 않았습니다
- **예약 스캔**(결정 2601-②): 매일 03:50 로컬. 보관 정리(04:00)보다 **앞에**
  둡니다 — 스캔이 남긴 기록을 보관이 곧바로 치우면 방금 만든 것을 못 봅니다
- **늘었을 때만 부른다**(결정 2601-③): 첫 스캔은 **기준선**(규칙을 처음 켠
  직후 전량을 경보로 만들면 아무 뜻이 없습니다) · 늘면 경보 · 같으면 조용 ·
  줄면 조용(기존 경보는 유지) · 0이 되면 해소. **경보를 만들지 않은 실행도
  기록**합니다 — "돌았지만 조용했다"와 "돌지 않았다"는 다릅니다
- **페이지**(결정 2601-④): `?offset`·`?limit`은 **목록만** 자르고
  **`summary`는 항상 전체 기준**입니다. 판정은 전량을 하되 내부에서 커서로
  나눠 읽습니다(`skip`은 읽는 도중 새 콘텐츠가 생기면 한 건을 두 번 세거나
  건너뜁니다)
- **규칙 캐시는 Request Scope만**(결정 2601-⑤): 스캔 한 번에 규칙을 한 번만
  읽습니다. **전역 캐시는 두지 않습니다** — 규칙을 고친 운영자가 언제
  반영되는지 알 수 없게 되면 규칙을 신뢰할 수 없습니다

절차: [content-governance.md](docs/operations/content-governance.md) §4.2 · §5.1

## Enterprise 거버넌스 운영 (TASK-2601, Sprint 26)

CTO 결정 2501-①~⑤ 반영 — 주제는 **켜 놓은 규칙을 운영하는 것**입니다.
TASK-2501이 발행 게이트를 켰고, 이번에는 그것을 **켜기 전에 세어 보고, 켠 뒤에
정리하는** 도구를 붙였습니다.

- **Preflight Scan**(결정 2501-①): 규칙을 처음 켜면 이미 `REVIEW`에 있던
  콘텐츠들이 위반을 담고 있을 수 있고, 그러면 **발행이 줄줄이 막힙니다.**
  켜기 전에 세어 봅니다. **상태를 바꾸지 않고, 자동으로 고치지 않고, 판정
  기록도 남기지 않습니다** — 훑어본 것을 발행 시도로 기록하면 이력이 사실과
  어긋납니다. 화면에도 "한 번에 고치기" 버튼이 없습니다
- **이미 나간 위반을 따로 셉니다**: `blocked`(발행 시 막힐 것)와
  `publishedViolations`(**이미 발행됨**)를 나눕니다 — 발행 게이트는 나가는
  것을 막지만 **이미 나간 것에는 아무 힘이 없습니다.** 섞어 세면 "위반 5건"이
  무슨 뜻인지 알 수 없습니다. 목록에서도 이미 나간 것이 먼저 옵니다
- **검사별 집계**로 무엇을 먼저 고칠지 알려줍니다. 목록을 자를 때는 **요약의
  숫자는 자르기 전 전체**이고, 잘랐다는 사실과 생략 건수를 문구에 적습니다
- **판정 기록 90일 보관**(결정 2501-⑤): 경보(1302-④)·Dead Letter(1501-③)와
  같은 정책입니다. **삭제하지 않습니다.** 기준은 **작성 시각**입니다 — 판정
  기록에는 해소라는 개념이 없습니다. 예약 정리 작업(`alert-archive`)에서 함께
  돌립니다(작업을 새로 만들면 같은 성격의 정리가 서로 다른 시각에 돌아 무엇이
  남았는지 흐려집니다). 보관된 것도 `?includeArchived=1`로 볼 수 있습니다 —
  **볼 길이 없으면 보관이 사실상 삭제입니다**
- **하지 않기로 한 것을 테스트로 고정**(결정 2501-②③④): 금지어 단어 경계·예외
  목록 없음(`최고`를 등록하면 `최고급`도 걸립니다 — 넓게 걸고 사람이 판단합니다) ·
  READY는 Advisory 유지(**강제 차단은 `PUBLISHED`뿐**) · 규칙 스코프는 GLOBAL만.
  하지 않기로 한 일은 코드에 흔적이 없어서 나중에 누가 되살려도 아무도 모릅니다

절차: [content-governance.md](docs/operations/content-governance.md) §3.1 · §4.1 · §6

## Enterprise 콘텐츠 거버넌스 (TASK-2501, Sprint 25)

주제는 **발행되는 것을 검사하는 것**입니다. Sprint 4부터 금지어·규칙 검사는
있었지만 **Product Object의 READY 전환에만** 걸려 있었고, 세상에 나가는
Content의 제목·본문에는 아무 검사가 없었습니다 — 발행 조건은 "REVIEW 상태이며
제목과 본문이 비어 있지 않다"뿐이었습니다. 상품을 검사하고 콘텐츠를 검사하지
않는 것은 **재료를 검사하고 완성품은 안 보는 것**과 같습니다.

- **발행 게이트**: `PUBLISHED` 전이에만 걸립니다. 금지어·필수 고지·제목/본문이
  실패하면 **발행을 막습니다**. 검토를 요청하는 것(`REVIEW`)과 세상에
  내보내는 것은 다르므로 다른 전이는 막지 않습니다
- **금지어는 제목과 본문을 모두** 봅니다(READY 판정은 상품 제목·브랜드·OCR만
  봤습니다). 스캔 규칙은 **READY 판정과 같은 함수**입니다 — 상품에서는 걸리는
  말이 콘텐츠에서는 안 걸리면 어느 쪽도 믿을 수 없습니다. 메시지는
  **어디에 몇 건**인지 말합니다(고칠 수 있어야 합니다)
- **필수 고지**: 분류별로 요구합니다(모든 상품에 모든 고지를 붙이면 본문이
  고지문으로 덮이고 아무도 읽지 않습니다). 공백·줄바꿈 차이는 무시합니다
- **경보와 차단을 구분**합니다: 근거 상품 연결이 끊긴 것과 관련 규칙이 있는
  것은 `주의`로 드러내되 막지 않습니다. 막는 항목은 응답의 `blocking`으로
  밝힙니다 — 화면이 "주의인데 왜 막혔지"를 추측하지 않게
- **미설정과 형식 오류를 구분**합니다: 둘 다 `주의`(막지 않음)지만 해야 할
  일이 다릅니다. 형식이 틀린 규칙을 **빈 목록으로 읽지 않습니다** — 그러면
  "위반 없음"이 되어 거짓 통과가 됩니다
- **판정을 기록**합니다(`content_governance_checks`, 삭제하지 않음).
  **그때의 기준**(금지어 수·적용 고지 id)을 함께 남깁니다 — 규칙은 나중에
  바뀌므로 "왜 이게 발행됐지"에 답하려면 그때의 기준이 있어야 합니다.
  **막힌 기록도** 남습니다 — 없으면 "왜 이렇게 늦게 발행됐지"에 답할 수 없습니다
- **미리보기와 게이트가 같은 판정 함수**를 부릅니다(`GET …/governance`) —
  화면이 "발행 가능"이라 했는데 누르면 막히는 상태를 구조적으로 없앴습니다

절차: [content-governance.md](docs/operations/content-governance.md)

## Enterprise 운영 준수 (TASK-2401, Sprint 24)

CTO 결정 2301-①~④ 반영 — 주제는 **같은 사실을 두 곳이 따로 판정하지 않게
하는 것**입니다. 화면마다 답이 다르면, 어느 쪽을 믿어야 할지 아무도 모릅니다.

- **복구 판정의 단일 원천**(결정 2301-①):
  `/ops/readiness`의 `recoverable`이 유일한 원천이고, 배포 체크리스트는 같은
  계층(`RecoveryEvaluationService`)을 호출해 **결론만 옮깁니다.** 이전에는
  배포 체크리스트가 순환 의존을 피하려고 **백업·복원 이력 개수**로 대신
  판정했고, 그래서 이력이 있으면 "복구 가능"으로 읽혀 **한 화면은 복구 가능,
  다른 화면은 복구 불가**가 될 수 있었습니다. 모듈 의존을 Health → Ops
  한 방향으로 정리해 순환 없이 같은 함수를 부릅니다
- **스키마가 코드보다 앞선 상태는 경보로**(결정 2301-②): 최초 관측은 `주의`,
  **7일을 넘기면 `심각`**. 되돌린 배포는 흔하고 직후에 사람을 부를 일은
  아니지만, **일주일이 지나도 그대로라면 되돌린 것이 아니라 잊은 것**입니다.
  **배포는 막지 않습니다** — 막으면 되돌린 배포를 다시 되돌릴 수 없습니다.
  경과는 경보의 `firstRaisedAt`으로 셉니다(경보는 삭제하지 않으므로 그 시각이
  곧 "처음 본 때"입니다 — 관측 기록용 테이블을 따로 두지 않았습니다)
- **S3 전환 후 Versioning 조회 실패는 실패**(결정 2301-③): 전환 전에는
  `직접 확인`, 전환 후에는 **실패(배포 차단)**입니다. Amazon S3는 조회를
  지원하므로, 못 읽는 것은 **저장소의 한계가 아니라 `s3:GetBucketVersioning`
  권한이 빠졌다는 뜻**입니다. 같은 상태에 같은 판정을 주면 전환의 의미 절반이
  사라집니다
- **`pendingMigrations`의 공식 의미**(결정 2301-④): **실제 미적용 개수**입니다.
  확인하지 못하면 `0`이 아니라 `null`(화면에는 `확인 불가`)입니다. 여기서
  결함 하나를 더 고쳤습니다 — **적용 중 실패한 행이 있으면 미적용 목록을
  비워** `pendingMigrations`가 0으로 보고됐습니다. 무엇을 먼저 알릴지(실패
  우선)와 무엇이 사실인지는 다릅니다

## Enterprise 배포 거버넌스 (TASK-2301, Sprint 23)

CTO 결정 2201-①~④ 반영 — 주제는 **경계를 문서가 아니라 판정으로 만드는 것**
입니다. "운영 담당자가 한다"고 적어 두는 것과, 하지 않았을 때 **배포가 막히는**
것은 다릅니다.

- **스키마도 운영 담당자가**(결정 2201-①): 저장소·IAM에 이어 DB 스키마까지
  같은 경계. 애플리케이션은 **적용하지 않고 검증만** 합니다. 검증만 한다는 것은
  **검증이 실제로 작동해야 한다**는 뜻이라, 실패 행만 세던 방식을 버리고
  **마이그레이션 디렉터리와 적용 기록을 대조**합니다 — 적용하지 않은
  마이그레이션은 실패 행조차 남기지 않아, 실패 행만 세면 "미적용 없음"이라는
  **거짓 통과**가 나왔습니다
- **자동 복구는 만들지 않습니다**(결정 2201-②): 원격 대조 실패는 Critical
  Alert만. 자동으로 다시 올리면 로컬 덤프가 온전한지 확인하지 않은 채
  **틀린 사본을 더 확실하게** 만들 수 있고, 사라진 이유를 모르는 채 올리면
  같은 일이 반복됩니다. 경보 문구에 **수동 복구**임과 절차 위치를 적습니다
- **우회 플래그를 두지 않습니다**(결정 2201-③): `STORAGE_PROVISIONING`은
  추가하지 않고 정책은 `NODE_ENV`만 봅니다. 설정해도 무시됨을 테스트로 고정
- **운영 표준 배포 체크리스트**(결정 2201-④):
  [deployment-checklist.md](docs/operations/deployment-checklist.md).
  **버킷 · IAM · 버전 관리 · 백업 버킷 · 재해 복구 판정**을 체크리스트 항목으로
  승격해 운영에서 **배포를 막습니다**. 문서로만 있는 체크리스트는 "확인했다고
  치는" 절차가 됩니다

## Enterprise 운영 준비 (TASK-2201, Sprint 22)

CTO 결정 2101-①~④ 반영 — 주제는 **운영에 넘길 수 있는 상태**입니다. 시스템이
스스로 준비하던 것을 놓고, **무엇이 필요한지 말하고 기다리는** 쪽으로 바꿉니다.

- **수동 대조는 최근 3건까지**(결정 2101-①): 자동(주 1회)은 1건 그대로입니다.
  주기적으로 도는 것은 비용이 반복되므로 최소로 두고, 사람이 필요할 때 한 번
  더 보는 쪽에만 폭을 줍니다. **상한을 두는 이유**는 "전부"를 허용하면 이력이
  쌓인 뒤 한 번의 클릭이 예상치 못한 전송 비용이 되기 때문입니다.
  **하나라도 실패하면 실패**입니다 — 3건 중 2건이 온전해도 잃은 1건은 그
  시점으로 되돌아갈 수 없다는 뜻이라, 평균을 내면 그 사실이 사라집니다
- **관측 창 상향은 Warning**(결정 2101-②): 상향은 유지하되 Readiness 항목
  `사슬 관측 창 설정`에 주의로 드러냅니다. **기동은 막지 않습니다** — 판정
  설정 하나 때문에 서비스가 뜨지 않으면 안 됩니다. 화면 한 줄로만 두면 아무도
  고치지 않으므로 **드러내되 세우지는 않는** 자리를 골랐습니다. 해석할 수 없는
  값도 같은 취급입니다(무시하되 무시했다고 말합니다)
- **CI 게이트 위치 고정**(결정 2101-③): Build 이후 유지. 앞으로 옮기면
  검증이 모듈을 못 찾아 **조용히 exit 2**가 되므로, 순서를 테스트로 고정했습니다
- **버킷·IAM은 운영 담당자가**(결정 2101-④): 운영에서 애플리케이션은 **버킷을
  만들지도, 정책을 걸지도 않습니다.** 오타 하나로 아무도 모르는 버킷이 생기고,
  운영자가 콘솔에서 조인 권한이 재기동마다 풀리기 때문입니다. 없으면 **누가
  무엇을 해야 하는지**까지 말합니다. 개발에서는 지금처럼 앱이 준비합니다

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/ops/backup/verify-remote?count=3` | **원격 사본 대조 (ADMIN)** — 수동은 최대 3건 |

## Enterprise 운영 자동화 (TASK-2101, Sprint 21)

CTO 결정 2001-①~⑤ 반영 — 2001에서 만든 판정을 **사람이 기억하지 않아도 도는
것**으로 바꿉니다. 규칙은 있는데 아무도 누르지 않으면 규칙이 없는 것과 같습니다.

- **사슬 관측 창 설정**(결정 2001-① · `BACKUP_CHAIN_WINDOW_HOURS`, 기본 24시간):
  **최소는 백업 간격의 4배**이고, 그보다 짧게 두면 자동으로 올리고 **올렸다고
  화면에 적습니다.** 창이 간격의 4배도 안 되면 창 안에 백업이 서너 개뿐이라
  한 번만 걸러도 판정이 뒤집힙니다 — 표본이 없는 판정은 잡음입니다
- **원격 대조 주 1회 자동**(결정 2001-②): 예약 점검 `remote-verify`가
  **마지막 백업 1건만** 내려받아 SHA-256을 대조합니다. **운영에서만** 켜집니다 —
  개발이 전송 비용을 낼 이유가 없습니다. 결과는 `backup_runs`에 남고, 화면과
  경보는 **그 기록을 읽습니다**(조회할 때마다 내려받으면 화면을 여는 것만으로
  돈이 나갑니다). **주기의 2배를 넘긴 성공은 통과로 두지 않습니다** — 예약이
  두 번 걸렀다면 그때의 결과는 지금의 사실이 아닙니다
- **`_major_` 파일명 규칙 + CI 교차 검증**(결정 2001-③): 매니페스트는 **잊기
  쉽고**(파일을 만들고 목록에 넣는 것을 잊습니다), 파일명은 **되돌리기
  쉽습니다**(이름을 바꾸면 지정이 사라집니다). 둘을 합집합으로 쓰고,
  `pnpm check:major-migrations`가 어긋남을 CI에서 막습니다
- **재기동 후 확인 절차**(결정 2001-④): 자동 등록은 기동 시 1회만 일어납니다.
  그 정책을 유지하는 대신 결과를 화면에 남깁니다 — **확인하지 못한 경우는
  `확인 불가`**이고, "등록할 것이 없었다"와 구분됩니다
- **Amazon S3 운영 전환 계획**(결정 2001-⑤):
  [s3-migration.md](docs/operations/s3-migration.md) — Sprint 21 완료 목표.
  저장소를 바꾸는 것보다 **보호 상태를 조회할 권한**을 빠뜨리지 않는 것이 핵심입니다

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/ops/checks/run?job=remote-verify` | **원격 대조 예약 점검 실행 (ADMIN)** |

## Enterprise 백업 무결성 (TASK-2001, Sprint 20)

CTO 결정 1901-①~⑤ 반영 — 지금까지는 **남은 기록**만 봤습니다. 이번에는
**남지 않은 것**을 봅니다.

- **백업 사슬 연속성**: 개별 백업이 모두 성공이어도 사슬은 끊길 수 있습니다.
  실패는 이력에 남지만 **돌지 않은 백업은 아무 데도 기록되지 않기** 때문에,
  서버가 멈춰 있던 구간은 이력만 보면 전부 성공으로 보입니다. 그래서 **있어야
  할 개수와 실제 개수를 비교**하고, 공백이 간격의 2배를 넘으면 **복구 필수
  항목이 실패**합니다 — 그 구간은 되돌아갈 수 없습니다
- **원격 사본 무결성**: 올렸다는 **기록**과 사본이 실제로 **있다**는 것은
  다릅니다. 원격 사본을 내려받아 SHA-256을 대조합니다. **전송 비용이 들어
  기본으로 돌지 않으며**(결정 1301-⑤의 연장), 확인하지 않은 상태는 통과가
  아니라 `직접 확인`입니다
- **운영 저장소 표준 = Amazon S3**(결정 1901-③): 운영에서 다른 엔드포인트면
  **실패**입니다. 다만 **개발자에게 S3를 요구하지 않습니다** — 개발에서
  개발 저장소를 쓰는 것은 정상입니다
- **DB 규모 재평가 신호**(결정 1901-④): 10 · 50 · 100GB에 도달하면 백업 성능
  기준을 **실측으로 다시 재라고** 알립니다. 기준마다 경보 키가 달라 10GB를
  해소하고 50GB에서 다시 알립니다. **기준을 자동으로 바꾸지는 않습니다**
- **Major Migration만 자동 등록**(결정 1901-①): 컬럼 하나 추가할 때마다
  리허설을 요구하면 **부를 일이 아닌데 부르는 것**이고, 그러면 정작 불러야 할
  때 오지 않습니다. `apps/api/prisma/major-migrations.json`에 지정된 것만
  자동 등록하고, `dr-change`·`pitr-adoption`은 운영자가 직접 등록합니다
- **중복 등록 금지**(결정 1901-⑤): 같은 `trigger`가 미해소면 `409`. 리허설
  1회로 함께 해소되므로 쌓을 이유가 없습니다
- **삭제 금지, 취소만**(결정 1901-②): `cancelledBy`·`reason`이 필수이고,
  취소된 요구는 **사유와 함께 남습니다.** 지운 요구는 왜 지웠는지 남지 않지만
  취소는 남습니다

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/ops/backup/verify-remote` | **원격 사본 대조 (ADMIN)** — 전송 비용이 듭니다 |
| `POST` | `/ops/drills/requirements/:id/cancel` | **요구 취소 (ADMIN)** — `{ cancelledBy, reason }` |

## Enterprise 복구 보증 (TASK-1901, Sprint 19)

CTO 결정 1801-①~⑤ 반영 — 관측만 하던 값에 기준을 붙이고, 판정이 미치지 않던
곳까지 같은 규칙을 넓히고, 달력에만 묶여 있던 리허설을 **변경에 반응하게**
합니다.

- **백업 소요 시간 기준**(결정 1801-①): 2초 미만 정상 / 2~10초 주의 /
  **10초 초과 연속 3회** 경보 / 30초 초과 심각. 연속 3회를 요구하는 이유는
  **한 번 느린 것은 흔하기 때문**입니다. **자동으로 간격을 바꾸지 않습니다** —
  시스템이 스스로 백업을 드물게 만들면 손실 구간이 조용히 늘어납니다
- **백업 버킷 보호**(결정 1801-③): 이미지 버킷과 같은 규칙으로 판정하고,
  문구에 **어느 버킷 이야기인지**를 넣습니다
- **운영 저장소 표준 = Amazon S3**(결정 1801-④): MinIO·s3rver는 개발
  전용입니다. 운영에서 다른 엔드포인트면 경고합니다
- **변경 후 즉시 추가 리허설**(결정 1801-⑤): DR 절차 변경 · DB 대규모 변경 ·
  PITR 도입이 등록되면 **기한이 남아도 실패**로 바뀝니다. **성공한 리허설만**
  이 요구를 해소합니다
- **배포 게이트에는 넣지 않습니다**(결정 1801-②): 리허설이 밀렸다는 이유로
  긴급 배포가 막히면 안 됩니다

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/ops/drills/require` | **변경 사건 등록 (ADMIN)** |
| `GET` | `/ops/drills/requirements` | **변경 사건 목록 (ADMIN)** |

## Enterprise 운영 플랫폼 (TASK-1801, Sprint 18)

CTO 결정 1701-①~⑤ 반영 — **판정만 하던 것을 지키게 만듭니다.**

- **백업 주기 1시간**(결정 1701-①): 시각 기반에서 간격 기반으로 바뀌어
  **최대 손실 구간이 24시간 → 2시간**이 됐습니다. 복구 절차는 그대로입니다.
  **손실 한도 목표가 간격을 따라갑니다**(간격 × 2) — 간격만 바꾸고 목표를
  묶어 두면 백업이 오래 멈춰도 "정상"으로 보입니다
- **백업 전용 버킷**(결정 1701-②): `BACKUP_BUCKET`(기본 `<S3_BUCKET>-backups`)
  으로 이미지와 분리합니다. 백업 버킷에는 **공개 읽기 정책을 걸지 않습니다** —
  덤프가 공개되면 데이터베이스 전체가 공개되는 것과 같습니다
- **Versioning 운영 필수 · Replication 권장**(결정 1701-③): 운영에서 버전 관리가
  꺼져 있으면 **실패**, 복제는 주의입니다. **조회가 불가능한 저장소는
  `직접 확인`을 유지**합니다 — 확인하지 못한 것을 "꺼짐"으로 단정하지 않습니다
- **복구 리허설 분기 1회**(결정 1701-⑤): 리허설은 사람이 하고, 시스템은
  **한 사실을 기록**하고 안 하면 드러냅니다. **실패한 리허설도 기록합니다** —
  절차가 깨졌다는 것을 사고 전에 알아낸 것이라 더 값집니다. 수행자는 필수이며,
  리허설이 밀린 것은 복구 가능 판정을 막지 않습니다

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/ops/drills` | **리허설 기록 (ADMIN)** — `{ ok, performedBy, findings? }` |
| `GET` | `/ops/drills` | **리허설 이력 (ADMIN)** |

## Enterprise 백업·재해 복구 (TASK-1701, Sprint 17)

"백업이 있고 복원된다"(1601) 다음의 세 질문 — **덤프가 온전한가 · 같은 곳에만
있지 않은가 · 얼마를 잃고 얼마나 걸리는가**.
절차는 [disaster-recovery.md](docs/operations/disaster-recovery.md), 백업 방식
검토는 [backup-strategy.md](docs/operations/backup-strategy.md).

- **Backup Integrity**: 백업 직후 `pg_restore --list`로 목차를 읽고 SHA-256을
  기록합니다. **읽히지 않는 덤프는 복구 불가**로 판정합니다 — 크기가 정상이어도
  복원할 수 없는 파일이면 복구 지점이 아닙니다
- **Offsite Replication**(`BACKUP_OFFSITE=on`): 덤프를 오브젝트 저장소에도
  올립니다. 복제 실패가 백업을 실패시키지는 않되(덤프는 이미 있습니다) 화면에
  드러납니다. 원격 키는 노출하지 않고 **있는지만** 알립니다
- **RPO · RTO**: RPO는 마지막 백업 이후 경과, RTO는 **실제 복원 검증에 걸린
  시간(측정치)**입니다. 다만 **하한**입니다 — 장애를 알아차리고 결정하는 시간은
  포함하지 않으며, 측정치가 없으면 통과로 세지 않습니다
- **복원 대상 강제 분리**(결정 1601-②): 복원 대상이 운영 DB와 같으면
  **기동하지 않습니다**. 자격 증명이 달라도 같은 DB는 같은 DB로 봅니다
- **`BACKUP_DIR` 운영 필수**(결정 1601-①): 미설정이면 **기동하지 않습니다** —
  백업이 컨테이너와 함께 사라지는 구성으로 운영을 시작할 수는 없습니다
- **이미지 저장소 보호**(결정 1601-④): 버전 관리·복제 상태를 체크리스트에
  표시합니다. **애플리케이션은 이미지를 직접 백업하지 않으며**, 저장소가 알려
  주지 않으면 `직접 확인`으로 남깁니다
- **WAL·PITR·증분**(결정 1601-③): 이번 Sprint는 **검토만** 했습니다 — 현재
  데이터 규모에서는 백업 주기 단축이 PITR보다 효과가 큽니다

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
