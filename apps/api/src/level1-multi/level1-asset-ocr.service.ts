import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OcrProvider } from "@acos/core";
import { OcrExecutionService } from "@acos/core";
import { OCR_PROVIDER } from "../ocr/ocr.constants";
import { StorageService } from "../storage/storage.service";
import { Level1AssetOcrStore } from "./level1-asset-ocr.store";

export interface Level1AssetOcrOutcome {
  assetId: string;
  status: "SUCCESS" | "FAILED";
  text: string;
  confidence: number | null;
  error: string | null;
}

/**
 * 업로드된 사진 전체에 대해 OCR을 별도 정보 추출 단계로 실행한다
 * (T1-196 요청 사양 1). `apps/api/src/ocr/ocr.service.ts`(Image용)와
 * 같은 목적이지만 Level1Asset을 대상으로 한다 — 이미 이 프로젝트에
 * 있는 OCR provider(`OCR_PROVIDER`, `OcrModule`이 만든 실제 어댑터,
 * 환경변수 `OCR_PROVIDER`로 선택)를 그대로 재사용한다(요청 사양 3:
 * "OCR은 AI가 아닌 별도 OCR provider가 이미 있으면 그것을 우선
 * 사용"). 새 OCR 엔진을 만들지 않는다.
 *
 * **실제 제품 사진(ACTUAL_PRODUCT)도, 포장/라벨/사양표/설명서/바코드
 * 사진도 전부 OCR 대상이다** — "업로드된 모든 사진"이라는 요청 사양을
 * 그대로 따른다. 어떤 사진을 시각 생성 reference로 쓸지(요청 사양 3의
 * "제품 외형 생성 reference로 전달하지 않는다")는 이 서비스가 아니라
 * `level1-multi.service.ts`의 기존 `NON_SHAPE_REFERENCE_ROLES` 게이트가
 * 계속 담당한다 — 이 서비스는 OCR만 하고 이미지 생성 경로에는 관여하지
 * 않는다.
 */
@Injectable()
export class Level1AssetOcrService {
  private readonly logger = new Logger(Level1AssetOcrService.name);
  private readonly execution: OcrExecutionService;

  constructor(
    private readonly storage: StorageService,
    store: Level1AssetOcrStore,
    @Inject(OCR_PROVIDER) provider: OcrProvider,
  ) {
    this.execution = new OcrExecutionService(provider, store, {
      maxAttempts: Math.max(1, Number(process.env.OCR_MAX_ATTEMPTS ?? 3)),
      onAttemptFailed: (attempt, error) =>
        this.logger.warn(`level1 OCR attempt ${attempt} failed: ${error}`),
    });
  }

  /**
   * 각 asset을 병렬로 실행하되, 한 장이 실패해도 나머지는 계속 진행한다
   * — OCR은 보조 정보 추출 단계이지 생성 파이프라인을 막는 관문이
   * 아니다(Gemini Vision 분석은 OCR 없이도 동작한다, 요청 사양 3의
   * 실행 순서는 "OCR → Product Facts 후보 → Gemini 분석/교차검증"이지만
   * OCR 실패가 전체 생성을 막으면 "정말 필요한 결정만 사람에게 미룬다"는
   * 원칙과 어긋난다 — 사람이 OCR 실패 사실 자체는 결과에서 그대로 본다).
   */
  async runForAssets(
    assets: { id: string; objectKey: string; mimeType: string }[],
  ): Promise<Level1AssetOcrOutcome[]> {
    const outcomes = await Promise.all(
      assets.map(async (asset): Promise<Level1AssetOcrOutcome> => {
        try {
          const run = await this.execution.execute(asset.id, asset.mimeType, () =>
            this.storage.getObject(asset.objectKey),
          );
          return {
            assetId: asset.id,
            status: run.status === "SUCCESS" ? "SUCCESS" : "FAILED",
            text: run.extractedText ?? "",
            confidence: run.confidence,
            error: run.error,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`level1 OCR 실행 중 예기치 않은 오류 (asset ${asset.id}): ${message}`);
          return { assetId: asset.id, status: "FAILED", text: "", confidence: null, error: message };
        }
      }),
    );
    return outcomes;
  }
}
