import type {
  ContentGenerationInput,
  ContentGenerationResult,
  ContentGenerator,
} from "../content-generator";

/**
 * Mock Content Generator. (CONTENT_GENERATOR=mock, 기본값)
 *
 * 실제 생성 모델을 연결하기 전까지 사용하며, Product Object의 필드를
 * 결정적인 Markdown 상세페이지로 렌더링한다.
 */
export class MockContentGenerator implements ContentGenerator {
  readonly name = "mock";

  async generate(
    input: ContentGenerationInput,
  ): Promise<ContentGenerationResult> {
    const { productObject } = input;
    const lines: string[] = [];

    lines.push(`# ${productObject.title}`);
    lines.push("");
    const badges = [
      productObject.category ? `카테고리: ${productObject.category}` : null,
      productObject.brand ? `브랜드: ${productObject.brand}` : null,
      `Product Object v${productObject.version} 기반`,
    ].filter(Boolean);
    lines.push(`> ${badges.join(" · ")}`);
    lines.push("");

    lines.push("## 상품 소개");
    lines.push(
      input.project.description?.trim() ||
        `${productObject.title}의 상세 정보를 확인해 보세요.`,
    );
    lines.push("");

    const attributeEntries = Object.entries(productObject.attributes);
    if (attributeEntries.length > 0) {
      lines.push("## 상세 정보");
      lines.push("| 항목 | 내용 |");
      lines.push("| --- | --- |");
      for (const [key, value] of attributeEntries) {
        lines.push(`| ${key} | ${value} |`);
      }
      lines.push("");
    }

    if (productObject.ocrSummary?.combinedText) {
      lines.push("## 제품 표기 정보");
      lines.push("```");
      lines.push(productObject.ocrSummary.combinedText);
      lines.push("```");
      lines.push("");
    }

    lines.push("---");
    lines.push("_이 상세페이지는 mock generator로 생성된 초안입니다._");

    return {
      title: `${productObject.title} 상세페이지`,
      body: lines.join("\n"),
      raw: {
        generator: this.name,
        input: {
          projectId: input.project.id,
          productObjectId: productObject.id,
          productObjectVersion: productObject.version,
        },
      },
    };
  }
}
