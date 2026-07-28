# TASKS — AI Product Content OS 작업 대장

> AGENTS.md와 함께 작업의 기준이 되는 문서다.
> - CTO(아키텍트)가 TASK 스펙을 이 문서(또는 채팅 지시)로 내려주면 **미완료** 섹션에 등록된다.
> - "다음 진행해" 지시 시 **미완료 섹션의 최상단 TASK**를 구현한다.
> - 새로운 기능을 임의로 추가하지 않는다 — 스펙 없는 항목은 "제안(스펙 대기)"에만 둔다.
> - TASK 완료 = 품질 게이트(Build/Test/TS/ESLint) 통과 + `/reports/CTO_REPORT.md` 갱신.

## 미완료 (스펙 확정, 구현 대기)

- (없음 — TASK-0602 완료. CTO 리뷰/승인 대기 중이며 승인 전 다음 TASK를 시작하지 않는다)

## 완료 — Sprint 6

- [x] **TASK-0602 — Execution Dashboard** (`162f165`): GET /executions/stats?from=&to= — 호출 수·성공률·실패율·토큰·비용(USD)·지연(가중 평균·최대)을 전체(totals) + feature/provider/model별로 집계, DB (차원,status) groupBy → @acos/core 순수 병합 로직(buildExecutionStats, DB 없이 단위 테스트), 기간 필터·날짜 검증 400, DB 변경 없음 — 해석 확인 CTO_REQUEST #23
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
- [ ] Content 발행 파이프라인 (DRAFT → REVIEW → PUBLISHED) 및 채널별 포맷

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
