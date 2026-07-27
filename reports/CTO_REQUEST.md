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

### 13. TASK-0402 "Structured Memory" 세부 해석 확인
- 현황: 지시된 5개 필드(scope/scopeId/key/value/description)로 구현하며
  다음을 보수적으로 결정했다:
  - **scope**: 자유 문자열 (예: `GLOBAL`, `PROJECT`) — Enum 목록이 지시에
    없어 고정하지 않음
  - **scopeId**: 선택(null 허용) — 전역 스코프는 대상 식별자가 없으므로
  - **value**: **Json** — "구조화 저장소" 취지에 맞게 문자열·숫자·배열·객체
    모두 저장 가능하게
  - **유니크 규칙**: `(scope, scopeId, key)` 조합당 1건 (중복 생성 400),
    수정은 value/description만 허용 (식별자 불변)
  - 기존 Memory는 **ProjectMemory**로 개칭·보존 (테이블 이름 변경으로
    데이터 보존, API 경로 `/projects/:id/memories` 유지)
- 질문: ① scope를 Enum으로 고정할지 (GLOBAL/PROJECT/… 목록 지시 요청)
  ② scope=PROJECT일 때 scopeId의 실존(projects.id) 검증을 넣을지
  ③ ProjectMemory를 장기적으로 폐기(표준 Memory로 이관)할지 유지할지.

### 11. TASK-0307 "Memory Engine Foundation" 해석 확인
- 현황: "Sprint Contract 스펙에 따라 구현" 지시를 받았으나 Contract 원문은
  여전히 미수신(#8)이다. 수신된 제약 2가지(Memory는 Company Brain 소속,
  Workflow Engine은 사용 가능하되 소유하지 않음)를 반영해 보수적으로 구현했다:
  - **Memory 엔티티**: id/projectId/title/content/source(선택)/createdAt/updatedAt
    — 필드 스펙이 없어 Decision Log와 같은 결로 최소 정의
  - **MemoryEngine** (@acos/core, Company Brain): remember(기록)/recall(회상,
    최신순)/get/revise(고쳐 쓰기)/forget(삭제), MemoryStore Port 위에서 동작
  - **CRUD API**: /projects/:id/memories — Project 1:N
  - **Workflow Engine과 미연결**: 소유 관계만 문서에 명시. 실행 단계에서
    기억을 참조/기록하는 연결은 스펙 수신 시 진행
- 하지 않은 것(스펙 없음): 검색/요약/중요도, 임베딩 유사 조회, SOP 단계 연동
- 요청: 엔티티 필드·Engine 동작이 Sprint Contract의 정의와 일치하는지 확인.

### 8. 잔여 TASK 상세 스펙 전달 요청 (유지)
- 현황: 0402는 필드 스펙까지 수신되어 해석 부담이 크게 줄었다 (감사).
  0403(Query Service)/0404(READY Validation Engine)는 아직 제목만 수신.
- 요청: 승인 시점에 0403의 조회 범위(대상 도메인·쿼리 형태·응답 형태),
  0404의 검증 규칙 소스(Knowledge category 연계 여부)와 적용 시점
  (READY 전이 시 강제? 별도 검증 API?) 스펙 전달 요청.

## 결정됨

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
