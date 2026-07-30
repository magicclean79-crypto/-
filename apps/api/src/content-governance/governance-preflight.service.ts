import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { describePreflight, summarizePreflight } from "@acos/core";
import type { PreflightItem } from "@acos/core";
import type {
  ContentStatus,
  GovernancePreflightDto,
} from "@acos/shared";
import { CONTENT_STATUSES } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ContentGovernanceService } from "./content-governance.service";

/** 목록에 담을 최대 건수 — 넘으면 **잘랐다고 말한다** */
export const DEFAULT_PREFLIGHT_LIMIT = 50;
export const MAX_PREFLIGHT_LIMIT = 200;

/**
 * 한 번에 판정할 콘텐츠 상한.
 *
 * 스캔은 콘텐츠마다 Company Brain을 읽으므로, 상한이 없으면 큰 프로젝트에서
 * 한 번의 조회가 수천 번의 판정이 된다. **넘으면 잘랐다고 말한다** —
 * 조용히 자르면 "위반 없음"이 거짓이 된다.
 */
export const MAX_PREFLIGHT_SCAN = 500;

/** 기본 스캔 대상 — 아직 나가지 않은 것 (발행이 막힐 것을 미리 본다) */
const DEFAULT_STATUSES: ContentStatus[] = ["DRAFT", "REVIEW"];

/**
 * Governance Preflight Scan. (TASK-2601, Sprint 26 — CTO 결정 2501-①)
 *
 * **위반 목록만 만든다. 상태를 바꾸지 않고, 자동으로 고치지 않는다.**
 *
 * 판정은 발행 게이트와 **같은 함수**(`ContentGovernanceService.judge`)를
 * 부른다 — 스캔이 "막힐 것"이라고 한 것이 실제로 막혀야 하고, 스캔이
 * 통과라고 한 것이 눌렀을 때 막히면 스캔을 볼 이유가 없다.
 *
 * 이 클래스는 **쓰기를 하지 않는다.** 판정 기록도 남기지 않는다 — 발행을
 * 시도한 것이 아니라 훑어본 것이고, 훑어본 것을 시도로 기록하면 이력이
 * 사실과 어긋난다.
 */
@Injectable()
export class GovernancePreflightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly governance: ContentGovernanceService,
  ) {}

  async scan(options: {
    projectId?: string;
    statuses?: string[];
    limit?: number;
  }): Promise<GovernancePreflightDto> {
    const limit = this.resolveLimit(options.limit);
    const statuses = this.resolveStatuses(options.statuses);

    if (options.projectId !== undefined) {
      const project = await this.prisma.project.findUnique({
        where: { id: options.projectId },
        select: { id: true },
      });
      if (!project) {
        throw new NotFoundException(
          `프로젝트를 찾을 수 없습니다: ${options.projectId}`,
        );
      }
    }

    const rows = await this.prisma.content.findMany({
      where: {
        ...(options.projectId !== undefined
          ? { projectId: options.projectId }
          : {}),
        status: { in: statuses },
      },
      orderBy: { createdAt: "desc" },
      // 상한 + 1을 읽어 **더 있는지**를 안다 — 딱 상한만 읽으면
      // "정확히 상한만큼 있는 것"과 "넘친 것"을 구분할 수 없다
      take: MAX_PREFLIGHT_SCAN + 1,
      include: {
        productObject: {
          select: { version: true, status: true, category: true },
        },
      },
    });

    const overflow = rows.length > MAX_PREFLIGHT_SCAN;
    const scanned = overflow ? rows.slice(0, MAX_PREFLIGHT_SCAN) : rows;

    const items: PreflightItem[] = [];
    for (const row of scanned) {
      const verdict = await this.governance.judge({
        id: row.id,
        projectId: row.projectId,
        status: row.status,
        title: row.title,
        body: row.body,
        productObject: row.productObject
          ? {
              version: row.productObject.version,
              status: row.productObject.status,
              category: row.productObject.category,
            }
          : null,
      });

      items.push({
        contentId: row.id,
        projectId: row.projectId,
        title: row.title,
        contentStatus: row.status,
        status: verdict.status,
        blockedBy: verdict.blockers.map((check) => check.key),
        warnings: verdict.checks
          .filter((check) => check.status === "WARNING")
          .map((check) => check.key),
      });
    }

    const result = summarizePreflight(items, { limit });

    return {
      projectId: options.projectId ?? null,
      summary: result.summary,
      items: result.items,
      truncated: result.truncated,
      omitted: result.omitted,
      detail:
        describePreflight(result) +
        // 판정 자체를 상한에서 끊었다면 그것도 말한다 — 목록을 자른 것과
        // 아예 보지 않은 것은 다르다
        (overflow
          ? ` 대상이 ${MAX_PREFLIGHT_SCAN}건을 넘어 최근 ${MAX_PREFLIGHT_SCAN}건만 판정했습니다 — 나머지는 검사하지 않았습니다.`
          : ""),
      scannedAt: new Date().toISOString(),
    };
  }

  private resolveLimit(raw: number | undefined): number {
    if (raw === undefined) {
      return DEFAULT_PREFLIGHT_LIMIT;
    }
    if (!Number.isInteger(raw) || raw < 1) {
      throw new BadRequestException("limit은 1 이상의 정수여야 합니다.");
    }
    return Math.min(raw, MAX_PREFLIGHT_LIMIT);
  }

  /**
   * 스캔 대상 상태.
   *
   * 기본은 아직 나가지 않은 것(`DRAFT`·`REVIEW`)이다. `PUBLISHED`를 넣으면
   * **이미 나간 위반**까지 본다 — 막을 수는 없지만 무엇이 나갔는지는 알아야
   * 한다.
   */
  private resolveStatuses(raw: string[] | undefined): ContentStatus[] {
    if (raw === undefined || raw.length === 0) {
      return DEFAULT_STATUSES;
    }
    const unknown = raw.filter(
      (value) => !(CONTENT_STATUSES as readonly string[]).includes(value),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `알 수 없는 상태입니다: ${unknown.join(", ")} ` +
          `(가능: ${CONTENT_STATUSES.join(", ")})`,
      );
    }
    return [...new Set(raw)] as ContentStatus[];
  }
}
