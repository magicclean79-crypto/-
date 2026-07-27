# CTO_REQUEST — 아키텍트 결정 요청 사항

> 엔지니어링에서 CTO(아키텍트)의 결정·확인이 필요한 항목을 기록한다.
> 결정되면 해당 항목을 "결정됨" 섹션으로 이동한다.

## 결정 대기

### 1. Project 엔티티 분리 여부
- 현황: TASK-0203의 `ProductObject.projectId`는 별도 Project 테이블이 없어
  기존 `Product`(업로드 그룹)를 프로젝트 단위로 참조한다.
- 질문: 별도 `Project` 엔티티(여러 상품/세션을 묶는 상위 개념)를 도입할지,
  현행 Product=프로젝트 구조를 유지할지?
- 영향: 도입 시 FK 마이그레이션 + 업로드/OCR/분석 API의 스코프 재정리 필요.

### 2. tesseract Provider 유지 여부
- 현황: OCR 기본 Provider는 mock이며, 로컬 오프라인 엔진(tesseract.js)이
  선택 옵션(`OCR_PROVIDER=tesseract`)으로 유지되어 있다. 외부 API 아님.
- 질문: Foundation 단계 원칙("실제 OCR 연결 금지")에 따라 제거할지,
  개발용 실측 엔진으로 유지할지?

### 3. ProductObjectStatus 전이 규칙
- 현황: `DRAFT / READY / ARCHIVED` enum만 정의, 전이 API는 미구현.
- 질문: READY 전환 조건(검수 주체, 필수 필드, Company Brain 검증 연동 시점)을
  어떻게 정의할지? 다음 TASK 스펙에 포함 요청.

### 4. 구(자체정의) TASK 산출물 처리
- 현황: 공식 스펙 이전에 구현된 Product CRUD + 웹 플로우(`d842338`),
  AI 분석 Foundation(`d49157a`)이 브랜치에 포함되어 있다.
- 질문: 로드맵과 충돌 없으면 유지 예정. 제거/변경이 필요하면 지시 요청.

### 5. Vision Foundation TASK 스펙 요청
- 현황: Product Object의 `visionSummary`는 mock. OCR/Analysis와 동일한
  Provider 교체 구조로 Vision TASK를 진행할 준비가 되어 있다.
- 요청: TASK 번호와 요구사항(대상 모델, 추출 필드) 스펙 전달 요청.

## 결정됨

(아직 없음)
