import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import type {
  ReadyValidationRequest,
  ReadyValidationResultDto,
} from "@acos/shared";
import { Public } from "../auth/write-protection.guard";
import { ReadyValidationService } from "./ready-validation.service";

@Controller("projects/:projectId/ready-validation")
export class ReadyValidationController {
  constructor(
    private readonly readyValidationService: ReadyValidationService,
  ) {}

  /** READY 전환 가능 여부 판정 — PASS / WARNING / FAIL */
  @Post()
  @HttpCode(200)
  @Public() // 판정만 수행(저장 없음) — 읽기 성격의 POST (TASK-0802)
  async validate(
    @Param("projectId") projectId: string,
    @Body() body?: ReadyValidationRequest,
  ): Promise<ReadyValidationResultDto> {
    return this.readyValidationService.validate(projectId, body ?? {});
  }
}
