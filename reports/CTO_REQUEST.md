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

### 12. TASK-0401 "Knowledge Foundation" 해석 확인
- 현황: Sprint 4 Backlog가 제목만 수신되어 다음과 같이 보수적으로 해석했다:
  - **Knowledge = 회사의 공식 지식(규칙·정책·가이드)** — 예: 금지어,
    필수 고지, 브랜드 가이드. Memory(프로젝트 1:N 경험적 기억)와 구분해
    **회사 전역**(projectId 없음)으로 정의 — 이후 0403 Query·0404 READY
    검증이 모든 프로젝트에 적용할 수 있도록.
  - 엔티티: id/title(필수)/content(필수)/category(선택, 자유 문자열)/시각
  - KnowledgeRepository Port(@acos/core) + Prisma 어댑터 + CRUD `/knowledge`
- 질문: ① 전역 스코프가 맞는지(프로젝트별 지식도 필요하면 지시 요청)
  ② category를 Enum으로 고정할지(decisionType 전례) ③ 0402 Structured
  Memory와의 경계 — Knowledge에 구조화 필드(예: 규칙 파라미터 Json)가
  필요하면 0402 스펙과 함께 지시 요청.

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
- 현황: Sprint 3에 이어 Sprint 4 Backlog(0401~0404)도 제목만 수신되어
  보수적 해석으로 구현 중이다 (0305는 리뷰에서 구조 수정 발생).
- 요청: TASK-0402(Structured Memory) / 0403(Query Service) /
  0404(READY Validation Engine)의 필드·범위 스펙을 승인 시점에 함께 전달
  요청 — 재작업 리스크를 줄일 수 있다.

## 결정됨

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
