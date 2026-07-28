# TASKS — AI Product Content OS 작업 대장

> AGENTS.md와 함께 작업의 기준이 되는 문서다.
> - CTO(아키텍트)가 TASK 스펙을 이 문서(또는 채팅 지시)로 내려주면 **미완료** 섹션에 등록된다.
> - "다음 진행해" 지시 시 **미완료 섹션의 최상단 TASK**를 구현한다.
> - 새로운 기능을 임의로 추가하지 않는다 — 스펙 없는 항목은 "제안(스펙 대기)"에만 둔다.
> - TASK 완료 = 품질 게이트(Build/Test/TS/ESLint) 통과 + `/reports/CTO_REPORT.md` 갱신.

## 미완료 (스펙 확정, 구현 대기)

- (없음 — TASK-1001 완료. CTO 리뷰/승인 대기 중이며 승인 전 다음 TASK를 시작하지 않는다)

## 완료 — Sprint 10

- [x] **TASK-1001 — Cross-Provider Routing Engine** (`03dca0f`): Feature별 Provider Mapping(LLM_ROUTE_CONTENT/ANALYSIS/VISION — `provider` 또는 `provider:model`) + Dynamic Routing(호출 시점 해석 — 재기동 불필요, 사용 불가 Provider는 기본으로 폴백 + 경고 로그, Failover는 CTO 지시로 범위 제외) + Routing Dashboard(GET /llm/routing + 웹 /routing — 결정 근거 배지 feature/default/fallback·폴백 사유·환경변수명) + Routing Metrics(/executions/stats의 byRoute — 경로 feature→provider별 호출·성공률·지연·토큰·비용) + Provider 인스턴스 맵(createLlmProviderMap — 키 설정된 Provider 전부, LlmService 단일 관문에서 경로별 게이트웨이 선택) — 우선순위(호출자 model > 규칙 :model > LLM_MODEL_* 동일 Provider만 > Provider 기본), 라이브 검증(분석→anthropic 실제 호출·기록, vision→gemini 폴백), 해석 확인 CTO_REQUEST #38

## 완료 — Sprint 9 (CTO 공식 종료, 2026-07-28)

- [x] **TASK-0903 — Anthropic & Gemini Provider Integration** (`f9cbda5`, CTO 승인 — Anthropic JSON은 System Prompt + JSON Parsing + Retry 방식 공식 표준 확정(Structured Output API는 추후 별도 Sprint 검토), 가격표는 공식 운영 모델만 등록(Preview 모델 제외), Sprint 9 공식 종료): Anthropic 공식 연결(JSON 전용 system 지시 강화 — Claude 4.6+ prefill 400이므로 미사용, 멀티모달 image block, 잘림 방어 stop_reason=max_tokens, 클라이언트 주입) + Gemini 공식 연결(responseMimeType application/json, inlineData 멀티모달, modelVersion 스냅샷 기록 → 접두사 매칭 비용, 잘림 방어 finishReason=MAX_TOKENS) + Provider Factory(Registry 기반 테이블 드리븐 provider.factory.ts — 키 단일 정의·mock 폴백, 새 Provider는 Registry·어댑터·가격표 3곳만) + Unified Execution(claude-opus-5/sonnet-5/haiku-4.5·gemini-2.5-flash 단가 등록, Registry 전 모델 가격표 등록을 테스트가 보증) + Provider Comparison Dashboard(/providers 비교 표 — 호출·성공률·평균 지연·토큰·비용·비용/호출) — 라이브 배선 검증(Anthropic 실 API 401 도달·Gemini mock 폴백), 해석 확인 CTO_REQUEST #37
- [x] **TASK-0902 — Cost Governance & Multi-Provider Foundation** (`5b39867`, CTO 승인 — 예산 정책 공식 표준 확정(80% Alert · 100% 초과 429 차단), Model Routing은 Provider 내부 모델 선택만 지원(Cross-Provider는 Anthropic/Gemini 공식 연결 이후), Budget은 환경변수 Code-first 유지(ADMIN 화면은 후속 Sprint)): Daily/Monthly Budget(LLM_DAILY/MONTHLY_BUDGET_USD, UTC 경계, 미설정=무제한 — 초과 시 LlmService 단일 관문 429 차단·Execution 미기록) + Cost Alert(80% 임계 LLM_BUDGET_ALERT_RATIO — 상태 전이 로그·대시보드 배지, core evaluateBudgetWindow 순수 로직) + Provider Registry(Code-first LLM_PROVIDER_REGISTRY — official/adapter-ready/mock·키 설정 여부만 노출, GET /llm/providers) + Model Routing(LLM_MODEL_CONTENT/ANALYSIS/VISION — 호출자 명시 우선, 선택된 Provider 내 모델 선택) + Provider Dashboard(웹 /providers — Registry·라우팅·예산 카드·Provider별 통계, Playwright 3종 → web e2e 21) + GET /llm/budget — 스키마 변경 없음, 해석 확인 CTO_REQUEST #36
- [x] **TASK-0901 — Real Provider Integration: OpenAI Production** (`8d095e3`, CTO 승인 — 출력 상한 공식 표준(Content 4096/Analysis 2048/Vision 2048, 환경변수 조정 유지), JSON은 length 시 FAILED·Text는 부분 결과 허용 확정, 실 Provider Smoke 정책 확정(운영/스테이징 배포 직후 1회 필수·모델 변경 시·인증/쿠키 변경 시 재실행 — 현재 런북·스크립트가 공식 운영 절차)): feature별 운영 출력 상한(LlmService 단일 관문 — content 4096/analysis 2048/vision 2048, LLM_*_MAX_TOKENS 조정) + JSON 잘림 방어(finish_reason=length+json → 명확한 오류·Execution FAILED) + OpenAI Production 통합 검증(주입 클라이언트로 실 응답 형태 재현 — Content 텍스트/Analysis json_object 엄격 파싱/Vision image_url 첨부/스냅샷 모델 접두사 비용/잘림 FAILED, openai-production.spec.ts 4종) + Production Smoke 10단계 확장(쿠키 전용 운영 모드 로그인 지원·운영 판정: byProvider/byFeature 커버리지·실키 cost>0) + 운영 런북(환경 세트) — 실키 네트워크 검증은 운영/스테이징 스모크 전용(0603 승인 ④), 해석 확인 CTO_REQUEST #35

## 완료 — Sprint 8 (CTO 공식 종료, 2026-07-28)

- [x] **TASK-0804 — Login Protection & Security Hardening** (`5ce8a20`, CTO 승인 — 기본 보안 정책 공식 표준 확정(Rate Limit 30회/60초·Lockout 5회/15분·Password 8자+영문+숫자, 환경변수 조정 유지), Rate Limit 인메모리 유지(다중 인스턴스 시 Redis 확장), Unlock 버튼 미구현(ADMIN Reset이 해제 절차), Idle Timeout 미구현(절대 TTL만), Sprint 8 공식 종료): Rate Limit(이메일 키 슬라이딩 윈도우 → 429, AUTH_LOGIN_MAX_ATTEMPTS/WINDOW_SEC 기본 30/60초) + Account Lockout(연속 5회 실패 → 15분 DB 잠금 users.lockedUntil, 성공 시 초기화·ADMIN 재설정 시 즉시 해제 — 마이그레이션 21) + Password Complexity(8자+영문+숫자, core 단일 정의 — 생성/변경/재설정 공통) + Failed Login Audit(LOGIN_FAILED·ACCOUNT_LOCKED, 액션 8종 + /admin/users 잠김 배지) + Cookie 전용 운영 모드(AUTH_COOKIE_ONLY — 운영/스테이징 기본, 본문 토큰 제외·쿠키만, 웹 credentials include) + Session Timeout(AUTH_SESSION_TTL_HOURS 기본 168h — 세션·쿠키 수명 통일) + Playwright 3종(웹 e2e 18종) — 해석 확인 CTO_REQUEST #34
- [x] **TASK-0803 — Password Management & Operational Security** (`40bd4d7`, CTO 승인 — 개발은 본문 토큰+httpOnly 쿠키 병행 유지·운영은 쿠키 전용 전환(→0804에서 이행), Reset은 ADMIN 직접 지정 유지(메일 기반은 메일 인프라 도입 후) 확정): 비밀번호 변경(PATCH /auth/password — 본인 확인·현재 세션 외 폐기·감사 PASSWORD_CHANGED) + 비밀번호 재설정(POST /auth/users/:id/password-reset, ADMIN — 대상 전 세션 폐기·자기 자신 불가·감사 PASSWORD_RESET) + httpOnly/Secure/SameSite 세션 쿠키(로그인 발급·Bearer→쿠키 순 인식·로그아웃 만료, AUTH_COOKIE_SECURE/AUTH_COOKIE_SAMESITE, core 순수 로직) + /llm/health 운영/스테이징 EDITOR+ 보호(AUTH_PROTECT_HEALTH, CTO 결정 0802-③) + /account UI·/admin/users 재설정 인라인(Playwright 3종, 웹 e2e 15종) — 스키마 변경 없음, 해석 확인 CTO_REQUEST #33
- [x] **TASK-0802 — User Management UI & Full Write Protection** (`3383e12`, CTO 승인 — @Public 예외 3종(Login·Company Brain Query·READY Validation)만 유지·새 쓰기 API 기본 보호, 권한 정책(Write EDITOR+/User Mgmt ADMIN/Logout VIEWER+/GET 유지) 확정, /llm/health는 운영/스테이징 EDITOR+ 인증(개발 비보호 가능)→0803에서 이행): 전면 쓰기 보호(WriteProtectionGuard APP_GUARD — 모든 POST/PATCH/PUT/DELETE 인증, 기본 EDITOR+, 읽기 성격 POST는 @Public, 조회 GET 비보호 유지) + 사용자 관리(목록/생성/역할 변경/비활성화 — 자기 자신 불가, 비활성화 시 세션 즉시 폐기) + Audit 확장(user_audit_log 4종 액션) + /admin/users UI(Playwright 3종, 웹 e2e 12종) + 웹 쓰기 호출 토큰 첨부·스모크 로그인 단계 — 해석 확인 CTO_REQUEST #32
- [x] **TASK-0801 — Authentication & Authorization Foundation** (`400b4ae`, CTO 승인 — Foundation 적용 범위(발행 전이·사용자 관리) 확정→0802에서 전면 확대 지시, 역할 3종 공식 표준, 토큰은 개발 localStorage·운영 httpOnly/Secure/SameSite 쿠키 전환 확정): User Entity(역할 3종)+DB 세션(Bearer 256비트, 7일)+scrypt 해시(@acos/core)+RBAC(AuthGuard/@RequireRole 계층 비교 — 발행 전이 EDITOR+, 사용자 생성 ADMIN)+Actor Audit(content_status_history.actor에 수행자 이메일)+Login UI(/login, localStorage 토큰, Playwright 3종) — 관리자 부트스트랩(AUTH_ADMIN_*), 적용 범위는 발행 전이·사용자 관리(전면 강제는 CTO 결정 대기), 해석 확인 CTO_REQUEST #31

## 완료 — Sprint 7 (CTO 공식 종료, 2026-07-28)

- [x] **TASK-0704 — Publishing Web UI & Audit History** (`dcc4817`, CTO 승인 — Audit는 from/to/timestamp 공식 표준(Actor는 인증 도입 후 추가→0801에서 이행), Publishing UI는 프로젝트 상세 유지 확정): 감사 이력(content_status_history — 전이 1건당 1레코드, 전이와 한 트랜잭션, GET …/contents/:id/history 최신순) + publishedAt 최초 발행 시점 보존 반영(0703 승인 ②) + 발행 Web UI(상태별 색상 Status Badge·allowedTransitions 기반 상태 변경 버튼·publishedAt UTC 표기·감사 이력 목록) + Playwright e2e 2종(전 구간 전이·되돌리기, 스텁 CORS) — 해석 확인 CTO_REQUEST #30
- [x] **TASK-0703 — Real Provider Smoke & Publishing Pipeline** (`1c28a52`, CTO 승인 — 전이 규칙 공식 표준 확정, publishedAt 최초 발행 시점 보존, 실키 스모크는 운영/스테이징 전용(개발은 mock 리허설만) 확정): 발행 파이프라인(PATCH /projects/:id/contents/:contentId/status — DRAFT→REVIEW→PUBLISHED→ARCHIVED, 전이 규칙 @acos/core canTransition 공식 사용, PUBLISHED는 isPublishable 검증+publishedAt 기록, 데이터 보존 마이그레이션) + 운영 스모크 테스트(scripts/real-provider-smoke.mjs 8단계 자동 판정 + docs/operations 절차 문서, mock 리허설 8/8 PASS — 실키 수행은 운영/스테이징) — 해석 확인 CTO_REQUEST #29
- [x] **TASK-0702 — Dashboard Filter & Web Testing** (`1f9ab8b`, CTO 승인 — stats 필터 공식 API·hour 31일 정책·자유 입력 유지(자동완성 후속)·Playwright 공식 게이트(모든 웹 기능 통과 필수) 확정): 대시보드 필터(Feature/Provider/Model/From/To UTC, GET 폼, stats+timeline 적용, interval 전환 시 유지) + Stats API 필터 확장(feature/provider/model) + hour 조회 최대 31일 제한(from 미지정 시 최근 31일 창, 초과 400) + Playwright CI 품질 게이트(web pnpm test — Dashboard/Filter/Empty/Error 스모크 4종, 모드 전환형 스텁 API, 사전 설치 chromium) — 해석 확인 CTO_REQUEST #28
- [x] **TASK-0701 — Execution Dashboard Web UI** (`eb202c6`, CTO 승인 — CSS 차트 유지(외부 라이브러리 미도입)·필터 추가·hour 31일 제한·Playwright CI 게이트 지시 → TASK-0702로 이행): /executions 운영 대시보드 — Stats/Timeline API 소비, KPI 카드 4종(성공률은 UI에서 % 표시), Timeline Chart(hour/day/week 전환·성공/실패 스택 막대·UTC 축·빈 버킷 UI 보간), Feature/Provider/Model 통계 테이블, 서버 컴포넌트+CSS 차트(외부 라이브러리 없음), API 미연결 안내 — 브라우저(Playwright) 검증, 해석 확인 CTO_REQUEST #27

## 완료 — Sprint 6 (CTO 공식 종료, 2026-07-28)

- [x] **TASK-0605 — Execution Timeline** (`7dbb42c`, CTO 승인 — UTC·ISO Week·hour/day/week 공식 표준, 빈 버킷은 UI 보간, hour 기간 제한은 다음 Sprint 확정): GET /executions/timeline?interval=hour|day|week — 호출 수·성공/실패율·토큰·비용·지연을 시간 버킷(UTC date_trunc, 오름차순, 데이터 있는 버킷만)으로 제공, feature/provider/model 정확 일치 + from/to 필터, DB (버킷,status) $queryRaw 집계(전 값 바인딩·interval 화이트리스트) → core buildExecutionTimeline 병합, 잘못된 interval/날짜 400 — 해석 확인 CTO_REQUEST #26
- [x] **TASK-0604 — Image Guard & Preprocessing** (`6c00dfb`, CTO 승인 — 기본 정책(20MB/1024px/5MB/JPEG q82)·위반 스킵 후 계속·업로드 원본 무변경(호출 시점 전처리) 확정): Vision Provider 호출 전 이미지 검증(MIME 허용 목록·원본 20MB·빈 파일)·리사이즈(최대 변 1024px, 비율 유지·확대 없음)·최적화(JPEG q82, 투명 PNG 유지)·EXIF 제거(Orientation은 픽셀 반영 후 삭제)·출력 5MB 제한 — core Port(ImageGuardPolicy/ImagePreprocessor) + sharp 어댑터(apps/api), 위반 이미지는 스킵(분석 계속, raw.skippedImages 기록)·인프라 오류는 null 폴백 유지, VISION_IMAGE_* 환경변수 조정 — 해석 확인 CTO_REQUEST #25
- [x] **TASK-0603 — Provider Integration (OpenAI)** (`34d1426`, CTO 승인 — 가격표 Code-first·접두사 매칭·cost null 유지, json_object 공식 구현, Health(실 ping+Execution 기록) 유지, 실키 검증은 운영/스테이징 확정): OpenAI Provider 공식 연결 — API Key(OPENAI_API_KEY, 없으면 mock 폴백), Health Check(GET /llm/health, 실호출 기반·Execution dev 기록), responseFormat→response_format json_object 매핑, Multimodal(image_url, 클라이언트 주입 단위 검증), Execution Cost(gpt-4o/$2.5·$10, gpt-4o-mini 단가 등록 + 스냅샷 모델 최장 접두사 매칭) — 실키 호출은 샌드박스 egress 제한으로 미검증(무효 키 배선 검증 완료), 해석 확인 CTO_REQUEST #24
- [x] **TASK-0602 — Execution Dashboard** (`162f165`, CTO 승인 — 지표 구성 유지·비율 0~1 API 반환(%는 UI)·from/to 공식 채택·화면은 다음 Sprint·일별 시계열은 Sprint 6 후반 확정): GET /executions/stats?from=&to= — 호출 수·성공률·실패율·토큰·비용(USD)·지연(가중 평균·최대)을 전체(totals) + feature/provider/model별로 집계, DB (차원,status) groupBy → @acos/core 순수 병합 로직(buildExecutionStats, DB 없이 단위 테스트), 기간 필터·날짜 검증 400, DB 변경 없음 — 해석 확인 CTO_REQUEST #23
- [x] **TASK-0601 — Execution Domain** (`fcbf6ce`, CTO 승인 — feature 4종·400 비기록·본문 비저장·가격표 Code-first·미등록 모델 cost null·FK 없는 독립 도메인 확정): 모든 LLM 호출(Content·Analysis·Vision·개발용)을 호출 1건당 Execution 1건으로 기록 — Execution 모델(feature/provider/model/token/cost USD/latencyMs/status/error) + 마이그레이션, ExecutionTracker(@acos/core, 기록 실패는 호출 미실패), 기록 지점은 LlmService.complete 단일화(feature 태깅), 비용은 코드 선언 가격표(mock 0, 미등록 모델 null), GET /executions 조회 API — 해석 확인 CTO_REQUEST #22

## 완료 — Sprint 5 (Goal: AI Execution — CTO 공식 종료, 2026-07-28)

- [x] **TASK-0506 — Legacy Generator Integration** (`574523a`, CTO 승인 — Wrapper 구조 유지·CONTENT_GENERATOR 제거 유지·Deprecated Generator는 Sprint 6 이후 제거 검토 확정): Deprecated 구 Generator 경로(POST /projects/:id/contents)를 제거하지 않고 EngineContentGenerator(Wrapper)를 통해 공식 Content Generation Engine 호출로 통합 — API 계약 유지, generateMarkdown() 생성 코어 공용화(두 경로 본문 동일 검증), CONTENT_GENERATOR 환경 변수 제거(MockContentGenerator는 @deprecated 보존), 0505 승인 결정 반영(VISION_MAX_IMAGES 환경 변수화) — 해석 확인 CTO_REQUEST #21
- [x] **TASK-0505 — Vision Multimodal Integration** (`d63a975`, CTO 승인 — 이미지 상한 유지+환경변수화·Mock Echo 공식 적용·VISION_PROVIDER 제거 유지·용량 제한은 실연결 전 구현 확정): 구 MockVisionProvider를 LLM 기반 멀티모달 공식 엔진(LlmVisionProvider)으로 교체 — Image Bytes(base64, 최대 5장) + Prompt Engine("vision-analysis" 템플릿) + LLM Gateway(images 멀티모달 확장 + 어댑터 3종 이미지 매핑) + Company Brain 사용, 응답 엄격 파싱(실패 시 재시도→null 폴백 유지), VisionSummary 모델·저장 위치 변경 없음, VISION_PROVIDER 환경 변수 제거(LLM_PROVIDER로 일원화) — 해석 확인 CTO_REQUEST #20
- [x] **TASK-0504 — Analysis Engine Integration** (`74e9fbb`, CTO 승인 — Mock JSON Echo 공식 전략·responseFormat 유지·ANALYSIS_PROVIDER 제거 유지 확정): 구 MockAnalysisProvider를 LLM 기반 공식 엔진(LlmAnalysisProvider)으로 교체 — Prompt Engine("product-analysis" 템플릿, 규칙 기반 초안 JSON 포함) + LLM Gateway(responseFormat "json") + Company Brain(상품 이름 기준 PROJECT 스코프) 사용, 응답 엄격 파싱(실패 시 재시도→FAILED), AnalysisResult 모델·API·1:N 이력 변경 없음, ANALYSIS_PROVIDER 환경 변수 제거(LLM_PROVIDER로 일원화) — 해석 확인 CTO_REQUEST #19
- [x] **TASK-0503 — Prompt Engine** (`9f44b87`): PromptTemplate+PromptEngine(@acos/core, 선언적 템플릿 레지스트리·결정적 렌더링), 상세페이지 프롬프트를 content-generation 템플릿으로 분리, 모든 AI 기능 공용 설계(등록→render→LLM Gateway), GET /prompt/templates — 0502 승인 결정 반영(웹 버튼 엔진 전환, 구 경로 Deprecated), 해석 확인 CTO_REQUEST #18
- [x] **TASK-0502 — Content Generation Engine** (`e147aef`): READY ProductObject + Company Brain(지식/결정/설정/금지어) + LLM Gateway로 Markdown 상세페이지 생성 → Content 저장, POST /projects/:id/contents/generate (구 mock 경로는 보존) — 해석 확인 CTO_REQUEST #17
- [x] **TASK-0501 — LLM Gateway Foundation** (`9a5a3e2`): LlmProvider Port + LlmGateway(검증·재시도, @acos/core) + MockLlmProvider 기본, Provider 어댑터 3종(OpenAI·Anthropic·Gemini, 공식 SDK), LLM_PROVIDER 환경변수 교체(키 미설정 시 mock 폴백), GET /llm · POST /llm/complete — 해석 확인 CTO_REQUEST #16

## 완료 — Sprint 4 (Goal: Company Brain Integration — CTO 공식 종료, 2026-07-27)

- [x] **TASK-0404 — READY Validation Engine** (`817ead4`): CompanyBrainService로 Knowledge/Memory/Decision/SOP를 읽어 READY 전환 가능 여부 판정 — 검사 6종, PASS/WARNING/FAIL 3단계(전체=최악 값), 금지어는 Memory(GLOBAL, banned-words) 기반, POST /projects/:id/ready-validation — 해석 확인 CTO_REQUEST #15

- [x] **TASK-0403 — Company Brain Query Service** (`7c2264a`): CompanyBrainService(읽기 전용, 조회 순서 Memory→Knowledge→Decision→SOP 고정), POST /company-brain/query({query, scope?, scopeId?, limit?} → 고정 순서 4개 섹션), 소스별 부분 일치 매칭 — 해석 확인 CTO_REQUEST #14
- [x] **TASK-0402 — Structured Memory Foundation** (`ce37a80`, CTO 승인 · scope Enum+규칙 반영 `2afd089`): 표준 Memory를 scope(GLOBAL/COMPANY/PROJECT/PRODUCT Enum)/scopeId(PROJECT·PRODUCT 실존 검증)/key/value(Json)/description 구조화 저장소로 재정의, (scope,scopeId,key) 유니크, CRUD API /memory — ProjectMemory는 사람용 메모·작업기록으로 유지
- [x] **TASK-0401 — Knowledge Foundation** (`0e028ec`, CTO 승인 · category Enum 반영 `d8e24d0`): Knowledge 엔티티(title/content/category?) + KnowledgeRepository Port(@acos/core, Company Brain 4번째 축), 회사 전역 확정, category Enum 8종(RULE/POLICY/GUIDE/BRAND/LEGAL/QUALITY/FAQ/OTHER), CRUD API /knowledge

## 제안 (스펙 대기 — 구현하지 않음)

- [ ] 실제 Provider/Generator 연결 (OCR/Analysis/Vision/Content 중 CTO 지정 — API 키·모델 스펙 필요, CTO_REQUEST #6)
- [ ] Content 채널별 포맷/배포 (발행 파이프라인 자체는 TASK-0703으로 구현됨)

## 완료 — Sprint 3 (CTO 최종 승인, 2026-07-27)

- [x] **TASK-0307 — Memory Engine Foundation** (`86cef6c`): Memory 엔티티+MemoryStore Port+MemoryEngine(remember/recall/revise/forget, @acos/core Company Brain), Prisma 어댑터, CRUD API /projects/:id/memories — Workflow Engine은 사용 가능하되 소유하지 않음(미연결, CTO 지시), 해석 확인 CTO_REQUEST #11
- [x] **TASK-0306 — Decision Log Foundation** (`a36c1b0`, CTO 승인 · Enum 반영 `7864c91`): Decision 엔티티(id/title/description/reason/decisionType/author/projectId/createdAt) + DecisionRepository Port(@acos/core, Company Brain), Prisma 어댑터, CRUD API /projects/:id/decisions, decisionType Enum 8종 고정(CTO 결정), docs/architecture/decision.md
- [x] **TASK-0305 — SOP Engine Foundation** (`5c67d54`, CTO 조건부 승인 반영): Company Brain의 SOP 정의(SopDefinition) + Execution Layer의 WorkflowEngine(@acos/core, 순차 실행·실패 시 후속 SKIPPED·단계 간 출력 전달), 기본 SOP product-content(OCR→조립→READY 검수→상세페이지, 기존 서비스 재사용), SopRun 실행 이력(Project 1:N), POST/GET /projects/:id/sop-runs
- [x] **TASK-0302 — Product Object 상태 전이** (`9374aae`): DRAFT⇄READY, →ARCHIVED(종결) 전이 규칙(@acos/core) + READY 필수 조건 검증(제목+OCR/Vision 요약), PATCH …/product-object/:version/status
- [x] **TASK-0303 — 상세페이지 콘텐츠 파이프라인** (`3a7fb00`): ContentGenerator Port + MockContentGenerator(Markdown), Content 모델 Project/ProductObject 소속 재구성, READY Product Object에서만 생성, /projects/:id/contents API
- [x] **TASK-0304 — 웹 UI Project 반영** (`0dd85bf`): /projects 목록·상세, 파이프라인 실행 버튼(조립→READY→상세페이지), 홈 내비게이션

## 완료 — Sprint 1~2

- [x] **Sprint 1 — Foundation** (`4048d62`): pnpm+Turborepo 모노레포, Next.js 16(web:3000) / NestJS 11(api:4000, /health), Docker Compose(PostgreSQL·Redis·MinIO), Prisma 초기 설정, web+api 동시 실행
- [x] **TASK-0201 — 사진 업로드** (`12bb3ae`): 드래그 앤 드롭·다중·진행률 UI, MinIO 저장, `Image` 모델, 업로드 API, 오류 처리
- [x] **TASK-0202 — OCR Foundation Architecture** (`4cf6882`): OCR 도메인 @acos/core 이전(Port/Adapter), MockOCRProvider 기본, Image:OCRResult 1:N 이력, PENDING/RUNNING/SUCCESS/FAILED, Jest 도입, docs/architecture/ocr.md
- [x] **TASK-0203 — Product Object Foundation** (`de5442d`): ProductObject 모델(버전 관리, DRAFT/READY/ARCHIVED), ProductObjectBuilder(OCR+Vision mock 조립), /projects/:id/product-object API, JSON Schema, docs/architecture/product-object.md
- [x] **(자체정의) Product CRUD + 웹 플로우** (`d842338`): /products CRUD, 업로드→Product 생성→목록/상세 웹 페이지 — CTO_REQUEST #4 처리 방침 대기
- [x] **(자체정의) TASK-0204 — AI Analysis Foundation** (`d49157a`): AnalysisProvider 교체 구조, Mock 기본, apply 옵션, docs/architecture/analysis.md
- [x] **(운영) AGENTS 협업 규칙 + CTO 보고 체계** (`81aab6f`, `20c87f0`): AGENTS.md, reports/CTO_REPORT.md·CTO_REQUEST.md
- [x] **TASK-0301 — Project Domain Foundation** (`55130af`): Project 최상위 루트 엔티티 도입(CTO_REQUEST #1 결정 반영), Project 1:N Product, ProductObject.projectId → projects.id 재지정, 데이터 보존 백필 마이그레이션, Projects CRUD API, 조립 시 프로젝트 전체 상품 집계
- [x] **TASK-0205 — Vision Provider Foundation** (`4fb0cf4`): VisionProvider Port + MockVisionProvider(@acos/core), VISION_PROVIDER 환경변수 선택, Product Object 조립에 주입(실패 시 null 폴백), docs/architecture/vision.md — CTO "다음" 지시로 제안 최상단 항목 승격
