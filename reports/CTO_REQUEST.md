# CTO_REQUEST — 아키텍트 결정 요청 사항

> 엔지니어링에서 CTO(아키텍트)의 결정·확인이 필요한 항목을 기록한다.
> 결정되면 해당 항목을 "결정됨" 섹션으로 이동한다.

## 결정 대기

### 44. TASK-1202 "Production Readiness & Deployment" 세부 해석 확인
- 현황: 지시 7항목을 다음과 같이 구현했습니다. 설계의 축은 **"문서로만 있는
  체크리스트는 지켜졌는지 확인할 수 없다"** 는 것입니다 — 기계가 판정할 수
  있는 항목은 전부 자동화하고, 사람이 봐야 하는 것만 "직접 확인"으로 남겼습니다:
  - **Environment Validation**: 환경변수 선언(`env-spec.ts`)을 **단일 원천**으로
    두고 검증·대시보드·런북이 같은 선언을 씁니다. 운영 필수 누락과 **형식
    오류**는 error(형식 오류는 환경 무관 — 잘못된 값은 어디서도 동작하지
    않습니다), 운영 권고 위반(mock Provider·예산 미설정·쿠키 Secure 꺼짐 등)은
    warning입니다
  - **Startup Validation**: 기동 시 검증하고 **운영에서 오류가 있으면 기동하지
    않습니다(exit 1)**. 잘못된 설정으로 뜬 서버는 조용히 오작동하다가 더 큰
    사고를 만들기 때문입니다. 개발에서는 경고만 남기고 기동합니다
  - **Deployment Checklist**: 환경·DB·마이그레이션·저장소·관리자 계정·실제
    Provider·예산·Failover를 자동 판정하고, **스모크·백업은 manual**로 남깁니다.
    마이그레이션은 확인할 수 없으면 통과가 아니라 "직접 확인"입니다 —
    **모르는 것을 통과로 처리하지 않습니다**
  - **Configuration Verification**: 설정 현황 표. **비밀 값은 설정 여부만**
    노출하고 값은 화면·응답 어디에도 담지 않습니다
  - **Health Dashboard**: 웹 `/admin/health` — 배포 가능 여부·차단 사유·
    체크리스트·구성 요소·환경 오류/권고·설정 현황. 구성 요소 점검은 **서로
    독립적으로 실패**합니다(저장소가 죽었다고 DB 상태까지 못 보면 장애 대응이
    어렵습니다)
  - **Runbook / Recovery Guide**: `docs/operations/`에 배포 절차와 **증상별
    복구 절차**(기동 실패·DB·저장소·Provider·예산·실험·설정 미반영·롤백·
    사고 후 정리)를 작성했습니다
  - **API**: `GET /health`는 기존 `OK` 계약을 그대로 두고(웹 상태 표시가
    의존), `GET /health/live`(무인증·내부 구성 비노출), **`GET /health/ready`는
    ADMIN 전용**(결정 1201-⑤와 같은 기준)입니다
  - **결정 1201-①~⑤ 반영**: ①②③④⑤ 모두 현행 유지로 확정하고, ②의
    `ADMIN_SETTINGS_TTL_MS`를 환경 선언에 등록, ④는 복구 가이드의 "설정이
    반영되지 않을 때" 절차로 명시했습니다
  - 라이브: 운영 모드 필수 누락 → **기동 차단 exit 1** · 정상 기동 시
    "환경 검증 통과 (22개 항목)" · **저장소가 실제로 내려간 상태를 정확히
    탐지**해 배포 불가 판정(DB·Provider 결과는 유지) · 복구 후 통과 8·실패 0·
    직접 확인 2로 배포 가능 · 미인증 401
- **구현 중 발견해 고친 표시 결함**: 개발 환경에서 예산·Failover 미설정 항목이
  상태는 `통과`인데 설명은 "비용 폭주를 막을 상한이 없습니다"·"단일 Provider
  장애가 곧 서비스 중단입니다"였습니다. **상태와 설명이 정면으로 모순**돼 읽는
  사람이 무엇을 해야 할지 알 수 없어, 환경별 문구로 분리하고 회귀 테스트를
  남겼습니다.
- 하지 않은 것: 배포 파이프라인 자동 연동(현재는 사람이 화면 확인), 백업
  자동화(런북에 절차만), 수동 항목 확인 기록
- 질문: ① **기동 차단 정책** — 운영에서 환경 오류가 있으면 서버를 아예 띄우지
  않습니다. 의도한 동작이지만, 배포 파이프라인이 이를 일시 오류로 오해해
  재시도하면 롤백이 늦어질 수 있습니다. 이대로 둘지, 아니면 "기동하되 요청을
  거부"하는 방식이 나은지 ② **운영 필수 항목 목록**이 적절한지 (현재
  `WEB_URL`·`DATABASE_URL`·S3 4종·`AUTH_ADMIN_EMAIL`/`PASSWORD`. 추가·제외할
  항목이 있는지) ③ **수동 항목(스모크·백업)** — 지금은 화면에 "직접 확인"으로만
  뜹니다. 누가 언제 확인했는지 기록하는 기능이 필요한지 ④ **배포 파이프라인
  연동** — CI에서 `/health/ready`를 호출해 차단 항목이 있으면 배포를 막는 것을
  다음 단계로 넣을지 ⑤ 다음 TASK 지정 요청.

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

### 43. TASK-1201 해석 확인 → 승인 + 설정 우선순위·전파·권한 확정 (2026-07-28)
- CTO 결정: ① **설정 우선순위는 DB Override → Environment Variable → Default**를
  공식 표준으로 확정 — **Code-first 원칙 유지** ② **다중 인스턴스 전파는 현재
  TTL 기반 구조 유지** — Redis Pub/Sub는 후속 Sprint에서 검토
  ③ **Routing 규칙(`LLM_ROUTE_*`)은 현재 Sprint 범위에 포함하지 않음**
  ④ **배포 시 Override는 자동 삭제하지 않고** 운영자가 명시적으로 해제
  ⑤ **`/admin/*`(Console·Audit)의 모든 조회와 변경은 ADMIN 인증 요구**
  ⑥ TASK-1202(Production Readiness & Deployment) 지시됨 — Environment
  Validation / Startup Validation / Deployment Checklist / Configuration
  Verification / Health Dashboard / Production Runbook / Recovery Guide.
- 반영(TASK-1202): ①③④⑤ 현행 유지 — 변경 없이 확정. ②의 `ADMIN_SETTINGS_TTL_MS`를
  환경 선언에 등록해 대시보드·런북에서 보이게 함. ④는 복구 가이드의 "설정이
  반영되지 않을 때" 절차로 명시. ⑤와 같은 기준을 `/health/ready`에도 적용.
  ⑥ 7항목 구현 완료 (#44 참고).

### 42. TASK-1102 해석 확인 → 승인 + 분석 표준 확정 + Sprint 11 종료 (2026-07-28)
- CTO 결정: ① **최소 표본은 기본 30회 유지** — 향후 환경변수로 조정 가능하도록
  설계 ② **추천 우선순위는 성공률 → 호출당 비용 → 평균 지연**을 공식 표준으로
  확정 ③ **관측 기간은 START/STOP에서는 유지하고 Definition Signature 변경
  시에만 초기화** ④ **다중 비교 보정은 현재 도입하지 않음**
  ⑤ **Sprint 11 공식 종료** ⑥ Sprint 12 시작 — TASK-1201(Provider
  Administration Console) 지시됨 — Provider Enable/Disable / Model
  Management / Budget Management / Experiment Management / Audit Log.
- 반영(TASK-1201): ① `LLM_EXPERIMENT_MIN_SAMPLES`로 조정 가능(미설정 시 30).
  ② ④ 현행 유지 — 변경 없이 확정. ③ `experiment_states`에 `signature`·
  `signatureChangedAt`를 두고 정의가 바뀔 때만 초기화하도록 변경(마이그레이션
  24) — 지난 보고에서 올린 운영상 불편이 해소됨. ⑥ 5항목 구현 완료 (#43 참고).

### 41. TASK-1101 해석 확인 → 승인 + 기본 상태·배정 주체·권한·Audit 확정 (2026-07-28)
- CTO 결정: ① **상태 레코드가 없으면 RUNNING을 기본 상태로 유지**
  ② **Sticky Assignment는 Project 기반을 공식 표준으로 확정**
  ③ **Winner Promotion은 운영자 수동 절차 유지** ④ **권한 변경** —
  Start/Stop은 EDITOR 이상, **Promote/Rollback은 ADMIN 전용**
  ⑤ **정의 변경으로 재배정이 발생하면 Audit 이력을 남길 것**
  ⑥ TASK-1102(Experiment Analytics & Recommendation) 지시됨 — Variant
  Performance Summary / Success Rate·Latency·Cost Comparison / Winner
  Recommendation / Confidence Score / Analytics Dashboard.
- 반영(TASK-1102): ①②③ 현행 유지 — 변경 없이 확정(승격은 수동이므로 분석은
  근거 제공에 집중). ④ `@RequireRole("ADMIN")`으로 승격·되돌리기를 분리하고
  4개 명시 라우트로 구성. ⑤ `experiment_assignment_events` 신설(마이그레이션
  23) — 사유·이전/이후 변형·서명 기록, 대시보드 표시. ⑥ 7항목 구현 완료
  (#42 참고).

### 40. TASK-1003 해석 확인 → 승인 + 실험 표준 확정 + Sprint 10 종료 (2026-07-28)
- CTO 결정: ① **`unknown` 오류는 Failover 대상이 아님** — 현재 정책을 공식
  표준으로 확정 ② **실험 표기법은 `이름|종류|변형=가중치` 단일 형식 유지**
  ③ **종류(kind)는 운영 메타데이터이며 Routing 알고리즘에 영향을 주지 않음**
  ④ **배정과 실제 실행은 분리** — Assignment는 실험 결과, Execution은 실제
  수행 결과이며 Dashboard에 두 정보를 모두 유지 ⑤ **Sprint 10 공식 종료**
  ⑥ Sprint 11 시작 — TASK-1101(Sticky Assignment & Experiment Lifecycle)
  지시됨 — Project 기반 Sticky Assignment / Experiment Start·Stop /
  Winner Promotion / Rollback / Assignment Dashboard.
- 반영(TASK-1101): ①② 현행 유지 — 변경 없이 확정. ③ 배정 서명에서 kind·이름을
  제외해 "표시용"임을 코드로 못박음. ④ 배정을 `experiment_assignments`에
  따로 저장하고 실행 지표(`byVariant`)와 나란히 표시. ⑥ 5항목 구현 완료
  (#41 참고).

### 39. TASK-1002 해석 확인 → 승인 + 오류 분류·모델 승계·Health 표준 확정 (2026-07-28)
- CTO 결정: ① **Failover 대상 오류 확정** — Timeout · Provider 5xx ·
  Provider Rate Limit · 일시적 네트워크 오류. **제외** — Budget 초과 ·
  Validation 오류 · 인증 오류(401/403) · 잘못된 API Key · 잘못된 요청
  ② **Failover 시 전환된 Provider의 기본 모델 사용** — 현재 정책 유지
  ③ **Health 기본값 공식 표준 확정** — 연속 실패 3회 · Cooldown 60초 ·
  Half-open ④ **`GET /llm/health` 호출을 Failover 운영 계측(attempts,
  failovers, exhausted)에서 분리** ⑤ TASK-1003(Routing Experiment & Traffic
  Control) 지시됨 — Percentage / A·B / Canary / Weighted Routing +
  Experiment Dashboard.
- 반영(TASK-1003): ① `classifyFailoverError()`로 분류 규칙을 명시화하고
  대상 4종만 전환하도록 좁힘(미분류는 안전 측 제외 — #40 ①에 확인 요청).
  ② ③ 현행 구현과 일치 — 변경 없이 확정. ④ 진단 호출을 운영 계측에서 분리하고
  `metrics.healthChecks`로 별도 집계(건강 상태 반영은 유지). ⑤ 5항목 구현
  완료 (#40 참고).

### 38. TASK-1001 해석 확인 → 승인 + Routing 단위·Fallback·이력 Provider 확정 (2026-07-28)
- CTO 결정: ① **Routing 단위는 Feature 3종(Content / Analysis / Vision)을
  공식 표준으로 확정** — 프로젝트별·사용자별 Routing은 후속 Sprint
  ② **Fallback 정책은 설정 해석 시 기본 Provider 자동 전환을 유지** —
  실행 중 오류는 Failover 대상이며 Fallback 범위에 포함하지 않음
  ③ **이력 Provider 필드(`AnalysisRun.provider` 등)는 실제 Routing된
  Provider를 기록하도록 변경** — Execution과 동일한 의미로 통일
  ④ TASK-1002(Provider Failover Engine) 지시됨 — Provider Priority /
  Retry Policy / Timeout Policy / Health Check Integration / Failover
  Metrics, **Budget 초과와 Validation 오류는 Failover 대상 아님**.
- 반영(TASK-1002): ①② 현행 구현과 일치 — 변경 없이 확정하고, 실행 중 전환은
  Failover 계층으로 분리 구현. ③ `AnalysisRecognition.providerName` 신설로
  실제 호출 Provider를 이력에 기록(과거 이력 소급 변경 없음). ④ 5항목 구현
  완료 (#39 참고).

### 37. TASK-0903 해석 확인 → 승인 + JSON 방식·가격표 확정 + Sprint 9 종료 (2026-07-28)
- CTO 결정: ① **Anthropic JSON은 System Prompt + JSON Parsing + Retry
  방식을 공식 표준으로 확정** — Structured Output API는 추후 별도 Sprint
  에서 검토 ② **가격표는 공식 운영 모델만 등록** — Preview 모델은 제외
  ③ **Sprint 9 공식 종료** ④ Sprint 10 시작 — TASK-1001(Cross-Provider
  Routing Engine) 지시됨 (Provider Failover는 범위 제외).
- 반영(`03dca0f`): ①② 현행 구현과 일치 — 변경 없이 확정. Cross-Provider
  Routing Engine 구현 (#38 참고).

### 36. TASK-0902 해석 확인 → 승인 + 예산 표준·라우팅 범위 확정 (2026-07-28)
- CTO 결정: ① **예산 정책 공식 표준 확정** — 80% = Alert, 100% 초과 = 429
  차단 (현재 정책 유지) ② **Model Routing은 현재 Provider 내부 모델 선택만
  지원** — Cross-Provider Routing은 Anthropic/Gemini 공식 연결 이후 구현
  ③ **Budget은 환경변수(Code-first) 유지** — ADMIN 화면 관리 기능은 후속
  Sprint ④ TASK-0903(Anthropic & Gemini Provider Integration) 지시됨.
- 반영(`f9cbda5`): ①③ 현행 확정, ②의 전제인 3사 공식 연결 완료 —
  Cross-Provider Routing은 다음 지시 대기 (#37 참고).

### 35. TASK-0901 해석 확인 → 승인 + 운영 표준·스모크 정책 확정 (2026-07-28)
- CTO 결정: ① **출력 상한 공식 표준 확정** — Content Generation 4096 ·
  Product Analysis 2048 · Vision Analysis 2048 (환경변수 기반 조정 구조
  유지) ② **JSON 출력은 finish_reason=length 시 FAILED 처리, Text 출력은
  부분 결과 허용** ③ **실 Provider Smoke 정책 확정** — 운영/스테이징 배포
  직후 1회 필수 · 모델 변경 시 재실행 · 인증/쿠키 변경 시 재실행, 현재
  런북·스크립트를 공식 운영 절차로 사용 ④ TASK-0902(Cost Governance &
  Multi-Provider Foundation) 지시됨.
- 반영(`5b39867`): 전 항목 현행 구현과 일치 — 변경 없이 확정. 비용
  거버넌스·Provider Registry 구현 (#36 참고).

### 34. TASK-0804 해석 확인 → 승인 + 보안 표준 확정 + Sprint 8 종료 (2026-07-28)
- CTO 결정: ① **기본 로그인 보안 정책 공식 표준 확정** — Rate Limit
  30회/60초 · Lockout 5회 실패→15분 · Password 최소 8자+영문+숫자
  (환경변수 기반 조정 구조 유지) ② **Rate Limit 인메모리 유지** — 다중
  인스턴스 운영 시 Redis 기반 확장 ③ **별도 Unlock 버튼 미구현** —
  ADMIN Password Reset이 잠금 해제 절차 ④ **Idle Timeout 미구현** —
  Absolute Session TTL만 유지 ⑤ **Sprint 8 공식 종료** ⑥ Sprint 9 시작 —
  TASK-0901(Real Provider Integration — OpenAI Production) 지시됨.
- 반영(`8d095e3`): 전 항목 현행 구현과 일치 — 변경 없이 확정. OpenAI
  Production 구현 (#35 참고).

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
