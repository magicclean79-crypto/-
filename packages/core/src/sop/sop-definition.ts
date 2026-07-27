/**
 * SOP(Standard Operating Procedure) — 회사의 표준 업무 절차 정의 도메인.
 * (TASK-0305, CTO 리뷰 반영: Company Brain 소속)
 *
 * SOP는 실행 엔진이 아니다 — "무엇을 어떤 순서로 하는가"만 선언한다.
 * 실행은 Execution Layer의 WorkflowEngine(workflow/)이 담당하며,
 * 각 단계를 실제로 어떻게 수행하는지는 주입되는 WorkflowStepExecutor가 결정한다.
 * 프레임워크·인프라에 의존하지 않는다. 자세한 구조: docs/architecture/sop.md
 */
export interface SopStepDefinition {
  /** 단계 식별자 — SOP 내에서 유니크, 실행자(executor) 매칭 키 */
  key: string;
  /** 사람이 읽는 단계 이름 */
  name: string;
}

export interface SopDefinition {
  /** SOP 식별자 (예: "product-content") */
  key: string;
  name: string;
  description: string;
  /** 순차 실행되는 단계 목록 */
  steps: SopStepDefinition[];
}

/**
 * 기본 SOP — 상품 콘텐츠 표준 절차.
 *
 * 업로드된 이미지에서 상세페이지까지의 기존 파이프라인
 * (OCR → Product Object 조립 → READY 검수 → 상세페이지 생성)을
 * 하나의 표준 절차로 선언한다. 각 단계는 기존 서비스를 재사용한다.
 */
export const PRODUCT_CONTENT_SOP: SopDefinition = {
  key: "product-content",
  name: "상품 콘텐츠 표준 절차",
  description:
    "프로젝트 이미지 OCR → Product Object 조립 → READY 검수 → 상세페이지 생성",
  steps: [
    { key: "ocr", name: "OCR 실행" },
    { key: "assemble", name: "Product Object 조립" },
    { key: "ready", name: "READY 검수" },
    { key: "content", name: "상세페이지 생성" },
  ],
};
