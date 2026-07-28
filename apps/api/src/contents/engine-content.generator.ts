import type {
  ContentGenerationInput,
  ContentGenerationResult,
  ContentGenerator,
} from "@acos/core";
import { ContentGenerationService } from "./content-generation.service";

/**
 * 구 Generator 경로 → 공식 엔진 Wrapper. (TASK-0506, Sprint 5 — AI Execution)
 *
 * Deprecated된 ContentGenerator Port(TASK-0303)를 유지하면서 내부 구현만
 * 공식 Content Generation Engine(ContentGenerationService.generateMarkdown)으로
 * 통합한다 — CTO 결정(TASK-0502 승인 ②·TASK-0506 지시).
 * 구 API 계약(POST /projects/:id/contents)과 ContentsService의 흐름
 * (READY 검증 → generate → 저장)은 그대로다.
 */
export class EngineContentGenerator implements ContentGenerator {
  readonly name = "content-generation-engine";

  constructor(private readonly engine: ContentGenerationService) {}

  async generate(
    input: ContentGenerationInput,
  ): Promise<ContentGenerationResult> {
    const result = await this.engine.generateMarkdown({
      project: input.project,
      productObject: {
        version: input.productObject.version,
        title: input.productObject.title,
        brand: input.productObject.brand,
        category: input.productObject.category,
        attributes: input.productObject.attributes,
        ocrText: input.productObject.ocrSummary?.combinedText ?? null,
        visionLabels: input.productObject.visionSummary?.labels ?? [],
      },
    });

    return {
      title: result.title,
      body: result.body,
      raw: { generator: this.name, llm: result.llm },
    };
  }
}
