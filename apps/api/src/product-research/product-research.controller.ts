import { Body, Controller, Post } from "@nestjs/common";
import { identifyProduct, type ProductResearchResult } from "@acos/core";
import type { ProductIdentification } from "@acos/core";
import { ProductResearchService } from "./product-research.service";

interface RunProductResearchRequest {
  ocrText?: string | null;
  visionText?: string | null;
}

interface RunProductResearchResponse {
  identification: ProductIdentification;
  research: ProductResearchResult;
}

/**
 * 제품 자동 조사 API. (T1-22)
 *
 * OCR·Vision 텍스트를 받아 제품을 식별하고(T1-21), 식별된 경우에만 조사를
 * 수행한다. 브라우저/API 클라이언트가 결과를 바로 확인할 수 있도록 DB
 * 저장 없이 요청마다 계산해 돌려준다 — 교차 검증(T1-23) 이후 Product
 * Profile에 실제로 반영하는 것은 별도 단계다.
 */
@Controller("product-research")
export class ProductResearchController {
  constructor(private readonly service: ProductResearchService) {}

  @Post()
  async run(@Body() body: RunProductResearchRequest): Promise<RunProductResearchResponse> {
    const identification = identifyProduct({
      ocrText: body.ocrText ?? null,
      visionText: body.visionText ?? null,
    });
    const research = await this.service.research(identification);
    return { identification, research };
  }
}
