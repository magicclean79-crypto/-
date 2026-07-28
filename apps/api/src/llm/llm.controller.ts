import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import type {
  LlmCompleteRequest,
  LlmCompletionDto,
  LlmGatewayInfoDto,
  LlmHealthDto,
} from "@acos/shared";
import { LlmService } from "./llm.service";

@Controller("llm")
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  /** 선택된 Provider 확인 (기본 mock) */
  @Get()
  info(): LlmGatewayInfoDto {
    return this.llmService.info();
  }

  /** Provider 상태 점검 (TASK-0603) — 최소 완성 호출로 키/네트워크/모델 확인 */
  @Get("health")
  async health(): Promise<LlmHealthDto> {
    return this.llmService.health();
  }

  /** 텍스트 완성 — 게이트웨이를 통해 선택된 Provider 호출 */
  @Post("complete")
  @HttpCode(200)
  async complete(
    @Body() body: LlmCompleteRequest,
  ): Promise<LlmCompletionDto> {
    return this.llmService.complete(body ?? ({} as LlmCompleteRequest));
  }
}
