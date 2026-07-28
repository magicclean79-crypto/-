# CTO_REQUEST — 아키텍트 결정 요청 사항

> 엔지니어링에서 CTO(아키텍트)의 결정·확인이 필요한 항목을 기록한다.
> 결정되면 해당 항목을 "결정됨" 섹션으로 이동한다.

## 결정 대기

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

### 18. TASK-0503 "Prompt Engine" 세부 해석 확인
- 현황: 지시 사항(프롬프트 로직을 Content Generation에서 분리, 독립 엔진,
  모든 AI 기능 공용 설계)을 다음과 같이 구현했다:
  - **선언적 템플릿 구조**: `PromptTemplate`(key/name/description/build) +
    `PromptEngine`(레지스트리·렌더러, 중복/미등록 key 검증) — @acos/core,
    렌더링은 결정적(같은 컨텍스트 → 같은 메시지, LLM 없이 테스트 가능)
  - **공용 설계 규칙**: 새 AI 기능은 ①core에 템플릿 선언 ②기본 엔진 등록
    ③서비스에서 `PROMPT_ENGINE.render(key, context)` — 서비스 안에서
    프롬프트 문자열 직접 조립 금지 (docs/architecture/prompt.md에 명문화)
  - 상세페이지 프롬프트를 `content-generation` 템플릿으로 이관 —
    ContentGenerationService는 엔진 render만 사용 (출력은 기존과 동일)
  - `GET /prompt/templates` — 등록 템플릿 조회 (개발용)
- 하지 않은 것(스펙 없음): 템플릿 버전 관리, DB 저장(런타임 편집),
  프리뷰/render API 노출, 다국어 템플릿
- 질문: ① 템플릿을 코드 선언으로 유지할지 DB 관리(런타임 편집)로 갈지
  ② 템플릿 버전 관리 필요 여부 ③ 다음 확장 대상(Analysis/Vision 템플릿화
  또는 mock Generator 통합) 지정 요청.

## 결정됨

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
