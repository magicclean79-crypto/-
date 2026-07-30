import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { describePreflight, summarizePreflight } from "@acos/core";
import type { PreflightItem } from "@acos/core";
import type { ContentStatus, GovernancePreflightDto } from "@acos/shared";
import { CONTENT_STATUSES } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";

import { ContentGovernanceService } from "./content-governance.service";
import { GovernanceRulesService } from "./governance-rules.service";

/** 판정에 필요한 만큼만 읽는다 */
interface ScanRow {
  id: string;
  projectId: string;
  status: ContentStatus;
  title: string;
  body: string;
  createdAt: Date;
  productObject: {
    version: number;
    status: string;
    category: string | null;
  } | null;
}

/** 한 페이지에 담을 기본·최대 건수 */
export const DEFAULT_PREFLIGHT_LIMIT = 50;
export const MAX_PREFLIGHT_LIMIT = 200;

/**
 * 한 번에 읽어 판정하는 묶음 크기.
 *
 * **전체를 판정한다** (CTO 결정 2601-④: Summary는 항상 전체 기준). 다만 한
 * 번에 다 메모리에 올리지 않고 나눠 읽는다 — 판정 결과는 건당 몇 개의 문자열
 * 이므로 누적해도 가볍지만, 본문까지 전부 들고 있으면 큰 프로젝트에서 터진다.
 */
export const PREFLIGHT_BATCH_SIZE = 200;

/** 기본 스캔 대상 — 아직 나가지 않은 것 (발행이 막힐 것을 미리 본다) */
const DEFAULT_STATUSES: ContentStatus[] = ["DRAFT", "REVIEW"];

/**
 * Governance Preflight Scan. (TASK-2601 → TASK-2701)
 *
 * **위반 목록만 만든다. 상태를 바꾸지 않고, 자동으로 고치지 않는다**
 * (CTO 결정 2501-①).
 *
 * 판정은 발행 게이트와 **같은 함수**(`ContentGovernanceService.judge`)를
 * 부른다 — 스캔이 "막힐 것"이라고 한 것이 실제로 막혀야 하고, 스캔이 통과라고
 * 한 것이 눌렀을 때 막히면 스캔을 볼 이유가 없다.
 *
 * 이 클래스는 **쓰기를 하지 않는다.** 판정 기록도 남기지 않는다 — 발행을
 * 시도한 것이 아니라 훑어본 것이고, 훑어본 것을 시도로 기록하면 이력이
 * 사실과 어긋난다.
 *
 * **전체를 판정하고 목록만 페이지로 자른다** (CTO 결정 2601-④). 규칙은
 * 스캔 시작에 **한 번만** 읽어 그 스캔 내내 쓴다 (CTO 결정 2601-⑤ Request
 * Scope) — 전역 캐시는 두지 않는다.
 */
@Injectable()
export class GovernancePreflightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly governance: ContentGovernanceService,
    private readonly rules: GovernanceRulesService,
  ) {}

  async scan(options: {
    projectId?: string;
    statuses?: string[];
    limit?: number;
    offset?: number;
  }): Promise<GovernancePreflightDto> {
    const limit = this.resolveLimit(options.limit);
    const offset = this.resolveOffset(options.offset);
    const statuses = this.resolveStatuses(options.statuses);

    if (options.projectId !== undefined) {
      await this.ensureProject(options.projectId);
    }

    const items = await this.items({
      projectId: options.projectId,
      statuses,
    });
    const result = summarizePreflight(items, { limit, offset });

    return {
      projectId: options.projectId ?? null,
      summary: result.summary,
      items: result.items,
      page: result.page,
      truncated: result.truncated,
      omitted: result.omitted,
      detail: describePreflight(result),
      scannedAt: new Date().toISOString(),
    };
  }

  /** 프로젝트가 없으면 404 — 없는 프로젝트를 0건으로 답하면 오타를 알 수 없다 */
  async ensureProject(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    }
  }

  /**
   * 대상 전체를 판정한다.
   *
   * 커서(`createdAt`+`id`)로 나눠 읽는다 — `skip`으로 넘기면 읽는 도중
   * 새 콘텐츠가 생겼을 때 **한 건을 두 번 세거나 건너뛴다.**
   *
   * 규칙은 시작에 한 번 읽어 전체 판정에 재사용한다 (결정 2601-⑤).
   *
   * **판정 결과 전체를 돌려준다** (TASK-2801): 예약 스캔은 요약뿐 아니라
   * **어떤 콘텐츠가 위반인지**를 알아야 다음 실행에서 "새로 위반된 것"을
   * 가릴 수 있다(결정 2701-⑤). 페이지로 자른 목록으로는 그것을 할 수 없다.
   */
  async items(options: {
    projectId?: string;
    statuses?: ContentStatus[];
  }): Promise<PreflightItem[]> {
    return this.judgeAll(
      options.projectId,
      options.statuses ?? DEFAULT_STATUSES,
    );
  }

  private async judgeAll(
    projectId: string | undefined,
    statuses: ContentStatus[],
  ): Promise<PreflightItem[]> {
    const snapshot = await this.rules.snapshot();
    const items: PreflightItem[] = [];
    let cursor: { createdAt: Date; id: string } | null = null;

    for (;;) {
      const rows: ScanRow[] = await this.prisma.content.findMany({
        where: {
          ...(projectId !== undefined ? { projectId } : {}),
          status: { in: statuses },
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: PREFLIGHT_BATCH_SIZE,
        include: {
          productObject: {
            select: { version: true, status: true, category: true },
          },
        },
      });

      for (const row of rows) {
        const verdict = await this.governance.judge(
          {
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
          },
          snapshot,
        );

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

      if (rows.length < PREFLIGHT_BATCH_SIZE) {
        break;
      }
      const last = rows[rows.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
    }

    return items;
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

  /** 음수·소수는 400 — 조용히 0으로 되돌리면 다른 페이지를 보게 된다 */
  private resolveOffset(raw: number | undefined): number {
    if (raw === undefined) {
      return 0;
    }
    if (!Number.isInteger(raw) || raw < 0) {
      throw new BadRequestException("offset은 0 이상의 정수여야 합니다.");
    }
    return raw;
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
