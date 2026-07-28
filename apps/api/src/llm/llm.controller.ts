import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import type {
  LlmCompleteRequest,
  LlmCompletionDto,
  LlmGatewayInfoDto,
  LlmHealthDto,
} from "@acos/shared";
import { HealthProtectionGuard } from "../auth/health-protection.guard";
import { LlmService } from "./llm.service";

@Controller("llm")
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  /** 선택된 Provider 확인 (기본 mock) */
  @Get()
  info(): LlmGatewayInfoDto {
    return this.llmService.info();
  }

  /**
   * Provider 상태 점검 (TASK-0603) — 최소 완성 호출로 키/네트워크/모델 확인.
   * GET이지만 실 호출이 발생하므로 운영/스테이징에서는 EDITOR 이상 인증
   * (TASK-0803, CTO 결정 0802-③ — 개발 환경은 비보호 유지)
   */
  @Get("health")
  @UseGuards(HealthProtectionGuard)
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
