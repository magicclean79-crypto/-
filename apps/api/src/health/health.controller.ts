import { Controller, Get, UseGuards } from "@nestjs/common";
import type { LivenessDto, ReadinessReportDto } from "@acos/shared";
import { AuthGuard, RequireRole } from "../auth/auth.guard";
import { ReadinessService } from "./readiness.service";

/**
 * Production Readiness API. (TASK-1202, Sprint 12)
 *
 * - `GET /health` — 기존 생존 확인(무인증, 본문 `OK`) — 웹 상태 표시가
 *   이 계약에 의존하므로 그대로 둔다
 * - `GET /health/live` — 구조화된 생존 확인(무인증). 프로브용이라
 *   **아무 내부 구성도 담지 않는다**
 * - `GET /health/ready` — 배포 준비 보고(ADMIN). 설정·구성 요소 상태와
 *   체크리스트를 담으므로 콘솔과 같은 등급으로 보호한다 (CTO 결정 1201-⑤)
 */
@Controller("health")
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(private readonly readiness: ReadinessService) {}

  /** 생존 확인 — 무인증, 내부 구성 비노출 */
  @Get("live")
  liveness(): LivenessDto {
    return {
      status: "ok",
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      nodeEnv: process.env.NODE_ENV ?? "development",
    };
  }

  /**
   * 배포 준비 보고 — 환경 검증·구성 요소 점검·체크리스트.
   * 설정 구성과 오류 사유를 담으므로 **ADMIN 전용**이다.
   */
  @Get("ready")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async ready(): Promise<ReadinessReportDto> {
    return this.readiness.report();
  }
}
