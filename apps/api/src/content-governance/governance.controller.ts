import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import type { GovernancePreflightDto } from "@acos/shared";
import { AuthGuard, RequireRole } from "../auth/auth.guard";
import { GovernancePreflightService } from "./governance-preflight.service";

/**
 * Governance Preflight Scan API. (TASK-2601, CTO 결정 2501-①)
 *
 * **읽기만 한다.** 상태를 바꾸지 않고, 자동으로 고치지 않고, 판정 기록도
 * 남기지 않는다 — 훑어본 것을 발행 시도로 기록하면 이력이 사실과 어긋난다.
 *
 * 두 경로의 권한이 다르다:
 * - 프로젝트 범위는 같은 프로젝트의 콘텐츠 조회(`GET …/contents`)와 같은
 *   정보이므로 같은 수준으로 둔다.
 * - **전체 범위는 프로젝트 경계를 넘으므로 ADMIN 전용**이다.
 */
@Controller()
export class GovernanceController {
  constructor(private readonly preflight: GovernancePreflightService) {}

  /** 프로젝트 범위 스캔 */
  @Get("projects/:projectId/governance/preflight")
  async scanProject(
    @Param("projectId") projectId: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<GovernancePreflightDto> {
    return this.preflight.scan({
      projectId,
      statuses: parseStatuses(status),
      limit: parseLimit(limit),
    });
  }

  /** 전체 범위 스캔 — 프로젝트 경계를 넘으므로 ADMIN 전용 */
  @Get("governance/preflight")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async scanAll(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<GovernancePreflightDto> {
    return this.preflight.scan({
      statuses: parseStatuses(status),
      limit: parseLimit(limit),
    });
  }
}

/** `?status=REVIEW,PUBLISHED` — 값 검증은 서비스가 한다 */
function parseStatuses(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * `?limit=100` — 숫자가 아니면 `NaN`으로 넘겨 서비스가 400을 내게 한다.
 *
 * **조용히 기본값으로 되돌리지 않는다** — 잘못 적은 값이 무시되면 운영자는
 * 자기가 준 상한이 적용됐다고 믿는다.
 */
function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  return Number(raw);
}
