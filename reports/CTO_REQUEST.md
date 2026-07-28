# CTO_REQUEST — 아키텍트 결정 요청 사항

> 엔지니어링에서 CTO(아키텍트)의 결정·확인이 필요한 항목을 기록한다.
> 결정되면 해당 항목을 "결정됨" 섹션으로 이동한다.

## 결정 대기

### 19. TASK-0504 "Analysis Engine Integration" 세부 해석 확인
- 현황: 지시 사항(Prompt Engine/LLM Gateway/Company Brain으로 기존 Mock
  Analysis 교체, AnalysisResult 모델 유지)을 다음과 같이 구현했다:
  - **공식 엔진 = LlmAnalysisProvider** — 구 MockAnalysisProvider는 제거.
    `product-analysis` 템플릿 렌더링 → LLM Gateway 호출(responseFormat
    "json") → 응답 엄격 파싱(name 필수, 실패 시 재시도 후 FAILED)
  - **Company Brain**: 상품 이름 질의·PROJECT 스코프 조회 — 0502 결정
    (상품 제목 기준 검색)과 동일 기준을 분석에도 적용
  - **초안(Draft) 설계**: 프롬프트에 규칙 기반 초안 JSON(OCR 첫 줄→이름,
    category "미분류", confidence 0.3)을 포함해 "검증·보강"을 지시.
    mock LLM은 json 모드에서 이 초안을 그대로 반환 — 키 없는 오프라인
    환경에서도 전체 파이프라인이 결정적으로 동작
  - **LlmRequest.responseFormat("text"|"json") 추가** — 구조화 출력 계약.
    실제 어댑터 3종은 아직 프롬프트 지침으로만 강제(옵션 매핑은 실연결 시)
  - **ANALYSIS_PROVIDER 환경 변수 제거** — 분석 모델 선택을 LLM Gateway의
    LLM_PROVIDER 하나로 일원화
  - AnalysisResult 모델·분석 API 3종·1:N 이력·apply 동작은 변경 없음.
    새 실행은 provider `llm:<provider>`(예: llm:mock)로 기록, 구 mock 이력 보존
- 하지 않은 것(스펙 없음): 이미지 바이트(Vision) 멀티모달 입력, Provider별
  구조화 출력 옵션(json_schema) 매핑, 분석 결과의 Product Object 자동 반영
- 질문: ① 초안 에코 방식의 mock 설계·responseFormat 추가·ANALYSIS_PROVIDER
  제거가 의도에 부합하는지 ② Vision(이미지) 입력을 분석 프롬프트에 포함할
  시점 ③ 다음 TASK 지정 요청.

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
