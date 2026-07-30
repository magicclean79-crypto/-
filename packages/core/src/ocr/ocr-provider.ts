import type { OcrStatus } from "@acos/shared";

/**
 * OCR Provider 추상화 (Port).
 *
 * Google Vision, Azure Vision, AWS Textract, Naver CLOVA OCR 등
 * 어떤 엔진이든 이 인터페이스만 구현하면 교체할 수 있다.
 * 구현체(Adapter)는 인프라 계층(apps/api)이나 전용 패키지에 둔다.
 */
export interface OcrProvider {
  /** Provider 식별자. OCRResult.provider에 그대로 저장된다. */
  readonly name: string;

  /**
   * 이미지에서 텍스트를 추출한다.
   * 실패 시 reject — 재시도/상태 관리는 OcrExecutionService가 담당한다.
   */
  recognize(image: Uint8Array, mimeType: string): Promise<OcrRecognition>;
}

/** Provider가 반환하는 정규화된 인식 결과 */
export interface OcrRecognition {
  /** 추출된 전체 텍스트 */
  text: string;
  /**
   * 신뢰도 0.0 ~ 1.0 — **Provider가 주지 않으면 `null`** (TASK-2901).
   *
   * 엔진마다 신뢰도를 주는지가 다릅니다(Google Cloud Vision의 텍스트 감지는
   * 응답에 따라 없을 수 있습니다). 그때 **1.0으로 채우면 "확신한다"는 거짓**이
   * 되고, **0으로 채우면 실패처럼 읽힙니다** — 둘 다 뒤쪽 READY 검수의 판단을
   * 왜곡합니다. 모르면 `null`로 둡니다(평균 신뢰도 계산이 이미 null을 제외합니다).
   */
  confidence: number | null;
  /** Provider 원본 응답 (JSON 직렬화 가능해야 함) */
  raw: unknown;
}

/** OCR Domain 모델 — 저장소(Prisma 등)와 무관한 순수 표현 */
export interface OcrRun {
  id: string;
  imageId: string;
  provider: string;
  status: OcrStatus;
  extractedText: string | null;
  confidence: number | null;
  rawJson: unknown;
  error: string | null;
  attempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * OCR 실행 기록 저장소 (Port).
 * apps/api에서는 Prisma 어댑터가 구현하고,
 * 단위 테스트에서는 인메모리 구현을 사용한다.
 */
export interface OcrRunStore {
  /** 새 실행 레코드를 RUNNING 상태로 생성한다. (Image당 1:N) */
  start(imageId: string, provider: string): Promise<OcrRun>;
  markSuccess(
    id: string,
    result: OcrRecognition,
    attempts: number,
  ): Promise<OcrRun>;
  markFailed(id: string, error: string, attempts: number): Promise<OcrRun>;
}
