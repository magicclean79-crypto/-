# CTO_REQUEST — 아키텍트 결정 요청 사항

> 엔지니어링에서 CTO(아키텍트)의 결정·확인이 필요한 항목을 기록한다.
> 결정되면 해당 항목을 "결정됨" 섹션으로 이동한다.

## 결정 대기

### 34. TASK-0804 "Login Protection & Security Hardening" 세부 해석 확인
- 현황: 지시 6항목(Rate Limit · Account Lockout · Password Complexity ·
  Failed Login Audit · Cookie 전용 운영 모드 · Session Timeout) +
  Playwright를 다음과 같이 구현했다:
  - **Rate Limit**: 이메일 키 슬라이딩 윈도우 → 초과 시 **429**.
    기본 **30회/60초** (`AUTH_LOGIN_MAX_ATTEMPTS`/`AUTH_LOGIN_WINDOW_SEC`).
    인메모리 1차 방어 — 단일 인스턴스 전제(다중 인스턴스는 공유 저장소
    필요, 부채 기록)
  - **Account Lockout**: 연속 실패 **5회 → 15분 DB 잠금**
    (`AUTH_LOCKOUT_THRESHOLD`/`AUTH_LOCKOUT_MINUTES`, users.lockedUntil) —
    잠금 중 올바른 비밀번호도 거부, 시간 경과 자동 해제 + **ADMIN 비밀번호
    재설정 시 즉시 해제**, 성공 로그인 시 카운터 초기화
  - **Password Complexity**: **최소 8자 + 영문 1자 + 숫자 1자** — core
    단일 정의(Code-first), 생성·변경·재설정 공통
  - **Failed Login Audit**: LOGIN_FAILED(사유·n/임계) · ACCOUNT_LOCKED —
    실존 계정만 기록(스팸 방지), 감사 액션 8종. /admin/users 잠김 배지
  - **Cookie 전용 운영 모드**: `AUTH_COOKIE_ONLY`(운영/스테이징 기본
    켜짐) — 로그인 응답 본문 토큰 제외, httpOnly 쿠키만 사용(0803 승인 ①
    이행). 웹 인증 호출 전부 credentials include — 개발 Bearer/운영 쿠키
    양쪽 모드 동작
  - **Session Timeout**: `AUTH_SESSION_TTL_HOURS`(기본 168=7일) — 세션
    만료·쿠키 Max-Age 통일
- 하지 않은 것(스펙 없음): ADMIN "잠금 해제" 전용 버튼(재설정으로 해제
  가능), Rate Limit 공유 저장소(Redis 등 — 다중 인스턴스 확장 시),
  유휴(idle) 타임아웃(현재는 절대 TTL만), IP 키 Rate Limit(프록시 뒤
  신뢰 가능한 IP 확보 후)
- 질문: ① 기본값 확정 — Rate Limit 30회/60초 · 잠금 5회/15분 · 복잡도
  8자+영문+숫자가 적절한지 ② Rate Limit 인메모리(단일 인스턴스) 전제
  유지 여부 — 공유 저장소 도입 시점 ③ 유휴 타임아웃·잠금 해제 전용
  UI 필요 여부 ④ 다음 TASK 지정 요청 (Sprint 8 종료 여부 포함).

### 2. tesseract Provider 유지 여부
- 현황: OCR 기본 Provider는 mock이며, 로컬 오프라인 엔진(tesseract.js)이
  선택 옵션(`OCR_PROVIDER=tesseract`)으로 유지되어 있다. 외부 API 아님.
- 질문: Foundation 단계 원칙("실제 OCR 연결 금지")에 따라 제거할지,
  개발용 실측 엔진으로 유지할지?

### 4. 구(자체정의) TASK 산출물 처리
- 현황: 공식 스펙 이전에 구현된 Product CRUD + 웹 플로우(`d842338`),
  AI 분석 Foundation(`d49157a`)이 브랜치에 포함되어 있다.
- 질문: 로드맵과 충돌 없으면 유지 예정. 제거/변경이 필요하면 지시 요청.

### 6. 실제 Provider 연결 시점
- 현황: OCR/Analysis/Vision 전부 mock 기본. 실제 모델 연결 가이드는
  docs/architecture/*.md에 준비되어 있다.
- 요청: 어느 계층부터, 어떤 모델로 연결할지 스펙 요청 (API 키 확보 포함).

### 7. READY 전환 조건 확장 여부
- 현황: TASK-0302에서 최소 규칙(제목 + OCR/Vision 요약 중 1개)으로 구현됨.
- 질문: Company Brain 검증(금지어·필수 고지) 등 추가 조건의 도입 시점/규칙.

## 결정됨

### 33. TASK-0803 해석 확인 → 승인 + 쿠키/재설정 정책 확정 (2026-07-28)
- CTO 결정: ① **개발 환경은 본문 토큰 + httpOnly 쿠키 병행 발급 유지,
  운영 환경은 쿠키 전용으로 전환** ② **Password Reset은 현재 ADMIN 직접
  지정 방식 유지** — 메일 기반 재설정은 메일 인프라 도입 이후 구현
  ③ TASK-0804(Login Protection & Security Hardening) 지시됨.
- 반영(`5ce8a20`): ① 쿠키 전용 운영 모드(AUTH_COOKIE_ONLY — 운영/스테이징
  기본 켜짐, 본문 토큰 제외) 구현, 웹 credentials 대응 (#34 참고).

### 32. TASK-0802 해석 확인 → 승인 + 보호 정책 확정 (2026-07-28)
- CTO 결정: ① **@Public 예외는 Login · Company Brain Query · READY
  Validation 3개만 유지** — 새로운 Write API는 기본적으로 보호
  ② **기본 권한 정책 유지** — Write=EDITOR 이상 · User Management=ADMIN ·
  Logout=VIEWER 이상 · GET=현재 정책 유지 ③ **/llm/health는 운영/스테이징
  에서 EDITOR 이상 인증 요구** — 개발 환경은 비보호 유지 가능
  ④ TASK-0803(Password Management & Operational Security) 지시됨.
- 반영(`40bd4d7`): ③ health 보호 가드 구현(NODE_ENV/AUTH_PROTECT_HEALTH
  판정), ①②는 현행 유지 확정 — 비밀번호/쿠키 구현 (#33 참고).

### 31. TASK-0801 해석 확인 → 승인 + 인증 정책 확정 (2026-07-28)
- CTO 결정: ① **인증 적용 범위 현재 구조 유지** — Foundation 단계는 발행
  전이·사용자 관리만 강제, 조회 API·생성 파이프라인은 유지 (→ 전면 확대는
  TASK-0802로 지시됨) ② **역할 ADMIN/EDITOR/VIEWER 3종 공식 표준**
  ③ **토큰: 개발은 localStorage 유지, 운영 전환 시 httpOnly Cookie ·
  Secure Cookie · SameSite 적용** ④ TASK-0802(User Management UI & Full
  Write Protection) 지시됨.
- 반영(`3383e12`): 전면 쓰기 보호 + 사용자 관리 구현 (#32 참고). 운영 쿠키
  전환은 배포 도메인 확정 시 구현 항목으로 백로그 유지.

### 30. TASK-0704 해석 확인 → 승인 + Audit 표준 확정 + Sprint 7 종료 (2026-07-28)
- CTO 결정: ① **Audit History는 From/To/Timestamp만 기록하는 현 구조를
  공식 표준으로 유지 — Actor는 인증 시스템 도입 이후 추가**
  ② **Publishing UI는 프로젝트 상세 화면에 유지** ③ **Sprint 7 공식 종료**
  ④ Sprint 8 시작 — TASK-0801(Authentication & Authorization Foundation)
  지시됨.
- 반영(`400b4ae`): 인증 도입과 함께 Actor Audit 이행 (#31 참고).

### 29. TASK-0703 해석 확인 → 승인 + 발행 표준 확정 (2026-07-28)
- CTO 결정: ① **발행 상태 전이를 공식 표준으로 유지** — DRAFT→REVIEW,
  REVIEW→DRAFT, REVIEW→PUBLISHED, DRAFT/REVIEW/PUBLISHED→ARCHIVED,
  ARCHIVED는 종결 ② **publishedAt은 최초 발행 시점 보존** — ARCHIVED
  이후에도 유지 ③ **실키 스모크는 운영/스테이징 전용** — 개발 환경은
  mock 리허설만 ④ TASK-0704(Publishing Web UI & Audit History) 지시됨.
- 반영(`dcc4817`): publishedAt 최초 시점 보존 코드 반영, 발행 UI·감사
  이력 구현 (#30 참고).

### 28. TASK-0702 해석 확인 → 승인 + 게이트/정책 확정 (2026-07-28)
- CTO 결정: ① **stats의 feature/provider/model 필터를 공식 API로 유지**
  ② **hour 정책 확정** — 최근 31일 기본 창 + 31일 초과 400 ③ **Provider/
  Model 자유 입력 유지** — 자동완성은 후속 Sprint ④ **Playwright는 공식
  품질 게이트 — 모든 Web 기능은 Playwright를 통과해야 함**
  ⑤ TASK-0703(Real Provider Smoke & Publishing Pipeline) 지시됨.
- 반영(`1c28a52`): 현행 구현 확정 (#29 참고).

### 27. TASK-0701 해석 확인 → 승인 + Dashboard 확장 지시 (2026-07-28)
- CTO 결정: ① **CSS 기반 차트 구조 유지 — 외부 차트 라이브러리 미도입**
  ② **Dashboard Filter 추가** (Feature/Provider/Model/From/To)
  ③ **hour 조회 최대 31일 제한** ④ **Playwright를 CI 품질 게이트에 포함** —
  Dashboard/Empty/Error 스모크 ⑤ TASK-0702(Dashboard Filter & Web Testing)
  지시됨.
- 반영(`1f9ab8b`): ②③④ 전부 구현 (#28 참고).

### 26. TASK-0605 해석 확인 → 승인 + Timeline 표준 확정 + Sprint 6 종료 (2026-07-28)
- CTO 결정: ① **UTC · ISO Week · hour/day/week 구조를 공식 표준으로 유지**
  ② **빈 버킷은 API가 생성하지 않음 — UI에서 보간** ③ **hour 조회 기간
  제한은 다음 Sprint 추가** ④ **Sprint 6 공식 종료** ⑤ Sprint 7 시작 —
  TASK-0701(Execution Dashboard Web UI) 지시됨.
- 반영(`eb202c6`): 대시보드 화면 구현 — % 변환·빈 버킷 보간을 UI에서 수행
  (#27 참고).

### 25. TASK-0604 해석 확인 → 승인 + 정책 확정 (2026-07-28)
- CTO 결정: ① **Image Guard 기본 정책 유지** — 원본 20MB · 최대 변 1024px ·
  출력 5MB · JPEG q82 ② **위반 이미지는 스킵 후 계속 진행 유지**
  ③ **업로드 원본 무변경 — 전처리는 호출 시점에만 수행**
  ④ TASK-0605(Execution Timeline) 지시됨.
- 반영(`7dbb42c`): 현행 구현 확정, Timeline 구현 (#26 참고).

### 24. TASK-0603 해석 확인 → 승인 + 실키 검증 환경 확정 (2026-07-28)
- CTO 결정: ① **가격표 Code-first 유지** — gpt-4o/gpt-4o-mini 단가·접두사
  매칭·cost=null 정책 확정 ② **responseFormat json_object 매핑 공식 구현
  유지** ③ **Health Check(실 ping 호출 + Execution 기록) 구조 유지**
  ④ **실키 검증은 운영/스테이징 환경에서 수행** — 개발 환경 egress 제한은
  구현 문제 아님 ⑤ TASK-0604(Image Guard & Preprocessing) 지시됨.
- 반영(`6c00dfb`): 현행 구현 확정, 이미지 가드 구현 (#25 참고).

### 23. TASK-0602 해석 확인 → 승인 + Dashboard 로드맵 확정 (2026-07-28)
- CTO 결정: ① **지표 구성 현행 유지** ② **성공률/실패율은 API에서 0~1 값
  반환, %는 UI에서 표시** ③ **from/to 기간 필터 공식 API 채택**
  ④ **Dashboard 화면은 다음 Sprint 구현** ⑤ **일별 시계열은 Sprint 6 후반
  추가** ⑥ TASK-0603(Provider Integration — OpenAI 우선) 지시됨.
- 반영: 현행 구현과 일치 — 변경 없이 확정. 화면·시계열은 백로그 기록.

### 22. TASK-0601 해석 확인 → 승인 + 6항 결정 확정 (2026-07-28)
- CTO 결정: ① **feature 4종 유지**(content-generation/product-analysis/
  vision-analysis/dev) ② **400 Validation Error는 Execution 비생성**
  ③ **Prompt/Response 본문 비저장 — 운영 지표만 기록** ④ **LLM 가격표
  Code-first 중앙 정의 유지, 미등록 모델 cost=null 유지** ⑤ **FK 없는
  독립 도메인 유지** ⑥ TASK-0602(Execution Dashboard) 지시됨.
- 반영: 전 항목 현행 구현과 일치 — 변경 없이 확정. 실모델 공식 단가
  스펙은 확정 시 가격표(DEFAULT_LLM_PRICING) 1곳에 추가하면 됨 (요청 유지).

### 21. TASK-0506 해석 확인 → 승인 + Sprint 5 공식 종료 (2026-07-28)
- CTO 결정: ① **EngineContentGenerator의 apps/api Wrapper 구조 유지**
  ② **CONTENT_GENERATOR 환경변수 제거 상태 유지** — LLM_PROVIDER 하나만 사용
  ③ **Deprecated Generator는 Sprint 6 이후 제거 검토 대상** — 현재는 Wrapper만
  유지 ④ **Sprint 5 공식 종료** ⑤ Sprint 6 시작 — TASK-0601(Execution
  Domain) 지시됨.
- 반영(`fcbf6ce`): TASKS.md에 Sprint 5 종료 기록, Execution Domain 구현
  (#22 참고).

### 20. TASK-0505 해석 확인 → 승인 + 상한 환경변수화 지시 (2026-07-28)
- CTO 결정: ① **최대 이미지 수 제한 유지 + 환경변수로 관리 가능하게 개선**
  ② Mock JSON Echo 전략을 **Vision에도 공식 적용** ③ **VISION_PROVIDER 제거
  상태 유지** — LLM_PROVIDER 하나만 사용 ④ **이미지 용량 제한·리사이즈는
  실제 Provider 연결 전에 구현** ⑤ 구 Generator 통합은 TASK-0506으로 지시됨.
- 반영(`574523a`): `VISION_MAX_IMAGES` 환경 변수화(기본 5장), ④는 실연결 전
  구현 항목으로 백로그 기록.

### 19. TASK-0504 해석 확인 → 승인 + Mock 전략 확정 (2026-07-28)
- CTO 결정: ① **Mock JSON Echo(초안 반환)를 공식 Mock 전략으로 유지**
  ② **responseFormat(text/json) 유지** — 실제 Provider 연결 시 Provider별
  구조화 출력으로 매핑 ③ **ANALYSIS_PROVIDER 제거 상태 유지** —
  LLM_PROVIDER 하나만 사용 ④ Vision(이미지) 입력은 TASK-0505(Vision
  Multimodal Integration)로 지시됨.
- 반영(`d63a975`): 결정 사항 docs/architecture/llm.md에 명문화, Vision에
  동일 Mock 전략 적용 (#20 참고).

### 18. TASK-0503 해석 확인 → 승인 + Code-first 확정 (2026-07-28)
- CTO 결정: ① Prompt Template은 **Code-first 유지** — DB 관리 기능 미구현
  ② Template Version은 이번 Sprint 미구현 ③ **다음 확장 대상은 Analysis**
  → TASK-0504(Analysis Engine Integration)로 지시됨.
- 반영(`74e9fbb`): `product-analysis` 템플릿 추가로 공용 설계 실증 (#19 참고).

### 17. TASK-0502 해석 확인 → 승인 + 공식 엔진 확정 (2026-07-27)
- CTO 결정: ① Content Generation Engine이 **공식 생성 엔진**
  ② 구 Mock Generator는 **Deprecated** — 다음 Sprint에서 내부적으로
  새 엔진을 호출하도록 통합 ③ **웹 상세페이지 생성 버튼은 새 엔진 사용**
  ④ Company Brain 검색은 상품 제목 기준 유지 — 향후 브랜드/카테고리/
  OCR/Vision으로 확장.
- 반영(`9f44b87`): 웹 버튼 `/contents/generate` 전환(브라우저 클릭 검증),
  구 경로·Port에 @deprecated 표시 및 문서 갱신.

### 16. TASK-0501 해석 확인 → 승인 (2026-07-27)
- CTO 결정: ① 기본 모델은 **환경변수로만 관리** ② `/llm/complete`는
  **개발용 API로 유지** — 운영에서는 내부 서비스만 사용 ③ LLM 호출
  이력·비용은 이번 Sprint 미구현, **별도 Execution 도메인으로 분리**
  ④ Content 생성의 LLM Gateway 전환은 TASK-0502로 지시됨.

### 15. TASK-0404 해석 확인 → 승인 (2026-07-27)
- CTO 결정: ① 검사 6종 유지 ② READY Validation은 **Advisory Mode 유지** —
  FAIL이어도 전이를 차단하지 않음 ③ 검증 결과는 저장하지 않음.
- Sprint 4 공식 종료.

### 14. TASK-0403 해석 확인 → 승인 (2026-07-27)
- CTO 결정: ① **통합 조회 방식 유지** (fallback 아님)
  ② Memory value(Json) 검색은 **다음 Sprint에서 확장**
  ③ **SopRun은 Company Brain이 아님** — Query 대상 제외 확정.

### 8. 잔여 TASK 상세 스펙 전달 → Sprint 4 완료로 해소 (2026-07-27)
- 0404까지 지시 수신·구현 완료. 다음 Sprint 계획 시 TASK별 필드·범위
  스펙을 함께 받으면 재작업을 줄일 수 있다 (요청 유지 취지만 기록).

### 13. TASK-0402 세부 해석 → 승인 + scope Enum·규칙 확정 (2026-07-27)
- CTO 결정: ① scope Enum 4종 **GLOBAL/COMPANY/PROJECT/PRODUCT**
  ② 규칙 — GLOBAL→scopeId=NULL, PROJECT→Project 실존 검증, PRODUCT→Product
  실존 검증 ③ value는 Json 유지 ④ ProjectMemory는 폐기하지 않고
  **사람용 메모·작업기록 저장소**로 유지 (Memory = AI용 구조화 설정 저장소).
- 반영(`2afd089`): DB enum + 데이터 보존 마이그레이션, 도메인 검증, 실존
  검증 400. **COMPANY는 GLOBAL과 동일하게 scopeId=NULL로 해석**
  (별도 Company 엔티티가 없으므로 — 다르면 지시 요청).

### 11. TASK-0307 해석 확인 → 승인 후 TASK-0402에서 재정의로 해소 (2026-07-27)
- 메모형 Memory는 ProjectMemory(사람용 메모·작업기록)로 보존, 표준 Memory는
  구조화 저장소로 재정의 (#13 결정에 포함).

### 12. TASK-0401 해석 확인 → 승인 + 전역 확정 + category Enum 8종 (2026-07-27)
- CTO 결정: Knowledge는 회사 전역(Global)만 관리. category는
  RULE/POLICY/GUIDE/BRAND/LEGAL/QUALITY/FAQ/OTHER Enum으로 고정.
- 반영(`d8e24d0`): DB enum + 데이터 보존 마이그레이션, 공유 타입,
  도메인 검증 3중 강제.

### 10. decisionType 유형 → Enum 8종 고정 (2026-07-27)
- CTO 결정: ARCHITECTURE / PROCESS / PRODUCT / BUSINESS / TECHNICAL /
  QUALITY / SECURITY / OTHER.
- 반영(`7864c91`): DB enum + 데이터 보존 마이그레이션(대문자 매칭, 미매칭
  OTHER), 공유 타입, 도메인 검증 3중 강제.

### 9. TASK-0305 해석 확인 → 조건부 승인, 아키텍처 수정 반영 완료 (2026-07-27)
- CTO 리뷰: SOP는 실행 엔진이 아니라 **표준 업무 절차 정의 도메인(Company
  Brain)**, 실행은 **Workflow Engine(Execution Layer)** 으로 분리.
- 반영(`f929977`): SopEngine → WorkflowEngine 명칭·역할 변경(core/workflow),
  SOP 정의는 core/sop 유지, 문서 2계층 구조 반영. 로직 변경 없음.

### 3. ProductObjectStatus 전이 규칙 → TASK-0302로 구현 (2026-07-27)
- Sprint 3 지시에 따라 DRAFT⇄READY, →ARCHIVED(종결) + READY 최소 검증으로 구현.
  조건 확장은 #7로 이관.

### 1. Project 엔티티 분리 → 도입 결정, TASK-0301로 구현 (2026-07-27)
- Sprint 2 CTO 리뷰 승인에 따라 Project를 최상위 루트 엔티티로 도입.
- 데이터 보존 마이그레이션(기존 상품별 동일 id 프로젝트 백필),
  ProductObject.projectId → projects.id 재지정, Projects CRUD API 추가.

### 5. Vision Foundation TASK 스펙 요청 → TASK-0205로 진행 (2026-07-27)
- CTO "다음" 지시에 따라 제안 최상단 항목으로 진행. VisionProvider 교체 구조
  구현 완료(`4fb0cf4`), 실제 Vision 모델은 미연결(mock 기본) — 실연결은 #6으로 이관.
