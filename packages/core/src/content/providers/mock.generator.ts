import type {
  ContentGenerationInput,
  ContentGenerationResult,
  ContentGenerator,
} from "../content-generator";

/**
 * Mock Content Generator.
 *
 * @deprecated TASK-0506: 구 Generator 경로는 EngineContentGenerator(Wrapper,
 * apps/api)를 통해 공식 Content Generation Engine을 호출한다 — 이 구현은
 * CTO 지시로 보존되지만 더 이상 어디에도 연결되지 않는다.
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
