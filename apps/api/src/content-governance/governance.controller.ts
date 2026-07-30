import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import type {
  GovernancePreflightDto,
  GovernanceScanRunDto,
} from "@acos/shared";
import { AuthGuard, RequireRole } from "../auth/auth.guard";
import { GovernancePreflightService } from "./governance-preflight.service";
import { GovernanceScanService, projectScope } from "./governance-scan.service";

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
  constructor(
    private readonly preflight: GovernancePreflightService,
    private readonly scans: GovernanceScanService,
  ) {}

  /** 프로젝트 범위 스캔 */
  @Get("projects/:projectId/governance/preflight")
  async scanProject(
    @Param("projectId") projectId: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<GovernancePreflightDto> {
    return this.preflight.scan({
      projectId,
      statuses: parseStatuses(status),
      limit: parseNumber(limit),
      offset: parseNumber(offset),
    });
  }

  /**
   * 프로젝트 범위 예약 스캔 이력 (TASK-2701).
   * 경보를 만들지 않은 실행도 남아 있다 — "돌았지만 조용했다"와 "돌지
   * 않았다"는 다르다.
   */
  @Get("projects/:projectId/governance/scans")
  async projectScans(
    @Param("projectId") projectId: string,
    @Query("limit") limit?: string,
  ): Promise<{ runs: GovernanceScanRunDto[] }> {
    return {
      runs: await this.scans.history({
        scope: projectScope(projectId),
        limit: parseNumber(limit),
      }),
    };
  }

  /** 전체 범위 스캔 — 프로젝트 경계를 넘으므로 ADMIN 전용 */
  @Get("governance/preflight")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async scanAll(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<GovernancePreflightDto> {
    return this.preflight.scan({
      statuses: parseStatuses(status),
      limit: parseNumber(limit),
      offset: parseNumber(offset),
    });
  }

  /** 전체 범위 예약 스캔 이력 — ADMIN 전용 */
  @Get("governance/scans")
  @UseGuards(AuthGuard)
  @RequireRole("ADMIN")
  async allScans(
    @Query("scope") scope?: string,
    @Query("limit") limit?: string,
  ): Promise<{ runs: GovernanceScanRunDto[] }> {
    return {
      runs: await this.scans.history({
        scope: scope && scope.trim().length > 0 ? scope.trim() : undefined,
        limit: parseNumber(limit),
      }),
    };
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
 * `?limit=100`·`?offset=50` — 숫자가 아니면 `NaN`으로 넘겨 서비스가 400을
 * 내게 한다.
 *
 * **조용히 기본값으로 되돌리지 않는다** — 잘못 적은 값이 무시되면 운영자는
 * 자기가 준 값이 적용됐다고 믿고, 페이지의 경우 **다른 페이지를 보고 있는
 * 줄도 모른다.**
 */
function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  return Number(raw);
}
