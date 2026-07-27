import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import type {
  CompanyBrainQueryRequest,
  CompanyBrainQueryResponse,
} from "@acos/shared";
import { CompanyBrainService } from "./company-brain.service";

@Controller("company-brain")
export class CompanyBrainController {
  constructor(private readonly companyBrainService: CompanyBrainService) {}

  /** Company Brain 통합 조회 — Memory → Knowledge → Decision → SOP 순서 */
  @Post("query")
  @HttpCode(200)
  async query(
    @Body() body: CompanyBrainQueryRequest,
  ): Promise<CompanyBrainQueryResponse> {
    return this.companyBrainService.query(
      body ?? ({} as CompanyBrainQueryRequest),
    );
  }
}
