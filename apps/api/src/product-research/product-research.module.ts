import { Module } from "@nestjs/common";
import { LlmModule } from "../llm/llm.module";
import { ProductResearchController } from "./product-research.controller";
import { ProductResearchService } from "./product-research.service";
import { WEB_RESEARCH_PROVIDER } from "./web-research-provider";
import { createWebResearchProvider } from "./web-research-provider.factory";

/**
 * 제품 자동 조사 모듈. (T1-22)
 *
 * Provider 선택은 `WEB_RESEARCH_PROVIDER` 환경변수 하나로 관리한다
 * (`LlmModule`·`OcrModule`과 같은 구조). 비용 예산은 LLM·OCR과 같은 상한을
 * 공유한다(TASK-3001 원칙 재사용).
 */
@Module({
  imports: [LlmModule],
  controllers: [ProductResearchController],
  providers: [
    ProductResearchService,
    {
      provide: WEB_RESEARCH_PROVIDER,
      useFactory: () => createWebResearchProvider(),
    },
  ],
  exports: [ProductResearchService, WEB_RESEARCH_PROVIDER],
})
export class ProductResearchModule {}
