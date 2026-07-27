import type {
  OcrSummary,
  OcrTextSource,
  VisionSummary,
} from "@acos/shared";

export const PRODUCT_OBJECT_BUILDER_VERSION = "1.0.0";

const TITLE_MAX_LENGTH = 200;

/** Builder가 조립하는 결과 — 저장(버전/상태 부여)은 저장소 계층이 담당한다 */
export interface ProductObjectDraft {
  title: string;
  brand: string | null;
  category: string | null;
  attributes: Record<string, string>;
  ocrSummary: OcrSummary | null;
  visionSummary: VisionSummary | null;
  metadata: Record<string, unknown>;
}

export interface ProductObjectProjectInput {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Product Object Builder.
 *
 * OCR 결과와 Vision 결과를 하나의 Product Object로 조립한다.
 * 제목 우선순위: Vision 제안 제목 → OCR 첫 줄 → 프로젝트 이름.
 * 입력이 없어도 항상 유효한 Draft를 만든다.
 */
export class ProductObjectBuilder {
  private ocrSources: OcrTextSource[] = [];
  private vision: VisionSummary | null = null;
  private extraAttributes: Record<string, string> = {};
  private imageCount = 0;

  constructor(private readonly project: ProductObjectProjectInput) {}

  withOcrResults(sources: OcrTextSource[]): this {
    this.ocrSources = sources.filter((source) => source.text.trim().length > 0);
    return this;
  }

  withVisionSummary(vision: VisionSummary | null): this {
    this.vision = vision;
    return this;
  }

  withAttributes(attributes: Record<string, string>): this {
    this.extraAttributes = { ...this.extraAttributes, ...attributes };
    return this;
  }

  withImageCount(count: number): this {
    this.imageCount = count;
    return this;
  }

  build(): ProductObjectDraft {
    const ocrSummary = this.buildOcrSummary();
    const firstOcrLine = ocrSummary?.combinedText
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    const title = (
      this.vision?.suggestedTitle?.trim() ||
      firstOcrLine ||
      this.project.name
    ).slice(0, TITLE_MAX_LENGTH);

    return {
      title,
      brand: this.vision?.brand ?? null,
      category: this.vision?.category ?? null,
      attributes: {
        ...(this.vision
          ? { visionLabels: this.vision.labels.join(", ") }
          : {}),
        ...this.extraAttributes,
      },
      ocrSummary,
      visionSummary: this.vision,
      metadata: {
        builderVersion: PRODUCT_OBJECT_BUILDER_VERSION,
        projectName: this.project.name,
        imageCount: this.imageCount,
        ocrSourceCount: ocrSummary?.sources.length ?? 0,
        assembledAt: new Date().toISOString(),
      },
    };
  }

  private buildOcrSummary(): OcrSummary | null {
    if (this.ocrSources.length === 0) {
      return null;
    }
    const confidences = this.ocrSources
      .map((source) => source.confidence)
      .filter((value): value is number => value !== null);
    return {
      sources: this.ocrSources,
      combinedText: this.ocrSources
        .map((source) => source.text.trim())
        .join("\n---\n"),
      averageConfidence:
        confidences.length > 0
          ? Number(
              (
                confidences.reduce((sum, value) => sum + value, 0) /
                confidences.length
              ).toFixed(4),
            )
          : null,
    };
  }
}

/**
 * Vision 연동 전까지 사용하는 결정적 Mock Vision 요약.
 * 실제 Vision Provider가 붙으면 이 함수 호출부만 교체하면 된다.
 */
export function createMockVisionSummary(projectName: string): VisionSummary {
  return {
    source: "mock",
    labels: ["mock-vision", "product"],
    brand: null,
    category: "생활용품",
    suggestedTitle: projectName,
    confidence: 0.9,
  };
}
