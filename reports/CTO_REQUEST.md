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

### 8. Sprint 3 Contract 원문 전달 요청 (긴급)
- 현황: "Sprint Contract 기준 TASK-0302~0307 순차 구현" 지시를 받았으나
  Contract 본문이 채팅에 포함되지 않아 TASK-0305/0306/0307의 스펙을 알 수 없다.
- 기구현된 0302~0304가 Contract의 정의와 일치하는지도 검증이 필요하다.
- 요청: Sprint Contract 전문(또는 0305~0307 스펙) 전달. 수신 즉시
  TASKS.md 미완료 섹션에 등록하고 순차 구현한다.

### 9. TASK-0305 "SOP Engine Foundation" 해석 확인
- 현황: Sprint Contract 원문 미수신(#8) 상태에서 CTO의 단일 TASK 지시로
  TASK-0305를 구현했다. 스펙이 제목뿐이어서 다음과 같이 보수적으로 해석했다:
  - **SOP = 상품 콘텐츠 표준 절차의 선언적 정의 + 실행 엔진** (@acos/core,
    프레임워크 무관. 단계 상태 PENDING→RUNNING→DONE/FAILED, 실패 시 후속
    SKIPPED, 단계 간 출력 전달)
  - **기본 SOP `product-content`**: OCR → 조립 → READY 검수 → 상세페이지 생성
    — 기존 4개 서비스를 단계 실행자로 재사용, **신규 파이프라인 로직 없음**
  - **SopRun 실행 이력** (Project 1:N, 단계별 결과 Json),
    `POST/GET /projects/:id/sop-runs` API
- 하지 않은 것(스펙 없음): 커스텀 SOP 등록/편집, 다중 SOP 선택, 비동기 실행
  (큐), 단계 재시도 정책, 웹 UI 버튼.
- 요청: 위 해석이 Sprint Contract의 TASK-0305 정의와 일치하는지 확인.
  다르면 차이점 지시 요청 — 구조가 선언/실행 분리라 정의 교체 비용은 낮다.

## 결정됨

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
