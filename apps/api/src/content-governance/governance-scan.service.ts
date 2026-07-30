import { Injectable, Logger } from "@nestjs/common";
import {
  ALL_SCAN_SCOPE,
  compareScan,
  describeScanRun,
  describeScanScope,
  detectGovernanceScanAlert,
  diffViolations,
  projectScanScope,
  shouldSyncScanAlerts,
  summarizePreflight,
  NEW_VIOLATION_SAMPLE_LIMIT,
} from "@acos/core";
import type {
  DetectedAlert,
  PreflightItem,
  ScanTotals,
  ViolatingContent,
  ViolationDiff,
} from "@acos/core";
import type {
  ContentStatus,
  GovernanceScanRunDto,
  PreflightSummaryDto,
} from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { GovernancePreflightService } from "./governance-preflight.service";

/** 전체 범위의 비교 기준 키 */
export const ALL_SCOPE = ALL_SCAN_SCOPE;

/** 프로젝트 범위의 비교 기준 키 */
export function projectScope(projectId: string): string {
  return projectScanScope(projectId);
}

/** 범위의 경보 키 — 감지기와 같은 규칙이어야 해소 범위가 맞는다 */
export function scanAlertKey(scope: string): string {
  return `governance-scan:violations:${scope}`;
}

/**
 * 예약 스캔이 보는 상태.
 *
 * 이미 나간 위반까지 본다 — 예약 스캔은 "지금 이 시스템의 위반 총량"을
 * 재는 것이고, 막을 수 없는 것을 빼면 총량이 아니다.
 */
const SCAN_STATUSES: ContentStatus[] = ["DRAFT", "REVIEW", "PUBLISHED"];

export interface ScanOutcome {
  run: GovernanceScanRunDto;
  /** 이 실행이 만든 경보 (없으면 빈 배열) */
  alerts: { key: string; level: string; title: string }[];
}

export interface ScanScopeResult {
  outcome: ScanOutcome;
  detected: DetectedAlert[];
  /** 경보 저장소를 건드릴 때인가 (CTO 결정 2601-③) */
  shouldSync: boolean;
}

interface ScanRunRow {
  id: string;
  scope: string;
  scanned: number;
  blocked: number;
  publishedViolations: number;
  warned: number;
  clean: number;
  byCheck: unknown;
  verdict: string;
  previousTotal: number | null;
  total: number;
  alerted: boolean;
  trigger: string;
  violatingIds: unknown;
  newly: unknown;
  newlyCount: number | null;
  resolvedCount: number | null;
  createdAt: Date;
}

/**
 * Scheduled Governance Scan. (TASK-2701 → TASK-2801)
 *
 * 예약으로 위반을 훑고, **늘었을 때만** 경보한다 (결정 2601-③).
 *
 * TASK-2801에서 **범위가 프로젝트별로 나뉘었다** (결정 2701-③④):
 * 전체 숫자 하나로는 어디가 나빠졌는지 알 수 없고, 한 프로젝트가 나아지고
 * 다른 하나가 나빠지면 총량이 그대로라 **아무 경보도 오지 않는다.**
 *
 * 예약 실행은 프로젝트를 하나씩 훑고, **전체 범위는 그 결과를 합해서** 만든다
 * — 따로 한 번 더 훑으면 콘텐츠를 두 번 읽는 데다 **읽은 시점이 달라 전체와
 * 프로젝트별 숫자가 어긋날 수 있다.** 합으로 만들면 어긋날 수가 없다.
 *
 * 스캔 자체는 `GovernancePreflightService`가 하고(**쓰기 없음**), 이 계층은
 * 그 결과를 **기록하고 비교한다.** 기록하는 이유는 셋이다:
 *
 * - 지난 결과가 없으면 "늘었는가"를 판정할 수 없다 (결정 2601-③).
 * - 지난 **위반 목록**이 없으면 "무엇이 새로 위반됐는가"를 가릴 수 없다
 *   (결정 2701-⑤).
 * - **경보를 만들지 않은 실행도 남긴다** — "돌았지만 조용했다"와 "돌지
 *   않았다"는 다르고, 그 구분이 없으면 예약이 멈춘 것을 알아챌 수 없다.
 */
@Injectable()
export class GovernanceScanService {
  private readonly logger = new Logger(GovernanceScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preflight: GovernancePreflightService,
  ) {}

  /**
   * 한 범위를 스캔하고 결과를 기록한다 (수동·단일 범위 경로).
   *
   * 경보 동기화는 여기서 하지 않는다 — 경보 종류별 해소 범위를 다루는 것은
   * `ScheduledChecksService`의 책임이고(결정 1302-③), 이 계층이 직접 부르면
   * 같은 종류를 두 곳에서 동기화하게 된다. 대신 **감지 결과를 돌려준다.**
   */
  async run(options: {
    projectId?: string;
    trigger: string;
  }): Promise<ScanScopeResult> {
    if (options.projectId !== undefined) {
      // 없는 프로젝트를 "위반 0건"으로 답하면 오타를 알 수 없다
      await this.preflight.ensureProject(options.projectId);
    }
    const items = await this.preflight.items({
      projectId: options.projectId,
      statuses: SCAN_STATUSES,
    });
    return this.judgeScope({
      scope:
        options.projectId === undefined
          ? ALL_SCOPE
          : projectScope(options.projectId),
      items,
      trigger: options.trigger,
      projectNames: await this.projectNames(),
    });
  }

  /**
   * 예약 실행 — **프로젝트별로 훑고 전체는 합으로 만든다** (결정 2701-③).
   *
   * 프로젝트가 하나도 없어도 전체 범위 실행은 남긴다 — 실행 기록이 없으면
   * 예약이 멈춘 것과 구분되지 않는다.
   */
  async runScheduled(options: { trigger: string }): Promise<{
    results: ScanScopeResult[];
    detected: DetectedAlert[];
    /**
     * 이번에 해소를 판정해도 되는 경보 키 (결정 2701-④).
     *
     * 동기화 대상이 아닌 범위의 키는 넣지 않는다 — 넣으면 그 범위의 위반이
     * 그대로인데 "이번에 감지되지 않았다"며 해소된다.
     */
    resolvableKeys: string[];
    detail: string;
  }> {
    const projects = (await this.prisma.project.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    })) as { id: string; name: string }[];
    const projectNames = Object.fromEntries(
      projects.map((project) => [project.id, project.name]),
    );

    const results: ScanScopeResult[] = [];
    const everything: PreflightItem[] = [];

    for (const project of projects) {
      const items = await this.preflight.items({
        projectId: project.id,
        statuses: SCAN_STATUSES,
      });
      everything.push(...items);
      results.push(
        await this.judgeScope({
          scope: projectScope(project.id),
          items,
          trigger: options.trigger,
          projectNames,
        }),
      );
    }

    // 전체는 **합**이다 — 다시 훑지 않는다 (같은 시점의 같은 숫자여야 한다)
    const all = await this.judgeScope({
      scope: ALL_SCOPE,
      items: everything,
      trigger: options.trigger,
      projectNames,
    });
    results.push(all);

    const syncing = results.filter((result) => result.shouldSync);
    const alerting = results.filter((result) => result.detected.length > 0);

    return {
      results,
      detected: syncing.flatMap((result) => result.detected),
      resolvableKeys: syncing.map((result) =>
        scanAlertKey(result.outcome.run.scope),
      ),
      detail:
        `프로젝트 ${projects.length}개 + 전체 범위 스캔 · ` +
        `위반 총 ${all.outcome.run.total}건 · 경보 ${alerting.length}건` +
        (alerting.length > 0
          ? ` (${alerting
              .map((result) =>
                describeScanScope(result.outcome.run.scope, projectNames),
              )
              .join(", ")})`
          : ""),
    };
  }

  /**
   * 한 범위의 판정·기록 — 스캔 결과를 받아 비교하고 남긴다.
   *
   * 판정에 쓰는 `items`는 호출부가 읽어 온 것 그대로다. 여기서 다시 읽으면
   * 전체와 프로젝트별이 서로 다른 시점을 보게 된다.
   */
  private async judgeScope(options: {
    scope: string;
    items: PreflightItem[];
    trigger: string;
    projectNames: Record<string, string>;
  }): Promise<ScanScopeResult> {
    const { scope, items, trigger } = options;
    // 목록은 필요 없다 — 경보 판정은 총계로 한다
    const result = summarizePreflight(items, { limit: 0 });
    const current: ScanTotals = {
      blocked: result.summary.blocked,
      publishedViolations: result.summary.publishedViolations,
      scanned: result.summary.scanned,
    };

    // 위반 = 막는 검사가 하나라도 있는 것. `blocked + publishedViolations`와
    // 같은 집합이다(주의는 위반으로 세지 않는다) — 어긋나면 총계와 목록이
    // 서로 다른 말을 하게 되므로 테스트로 고정했다.
    const violations: ViolatingContent[] = items
      .filter((item) => item.blockedBy.length > 0)
      .map((item) => ({
        contentId: item.contentId,
        title: item.title,
        contentStatus: item.contentStatus,
      }));

    const previous = await this.previousRun(scope);
    const change = compareScan(previous?.totals ?? null, current);
    const diff = diffViolations(previous?.violatingIds ?? null, violations);
    const detected = detectGovernanceScanAlert(change, current, {
      scope,
      projectNames: options.projectNames,
      diff,
    });
    const detail = describeScanRun(change, current, diff);

    const row = (await this.prisma.governanceScanRun.create({
      data: {
        scope,
        scanned: result.summary.scanned,
        blocked: result.summary.blocked,
        publishedViolations: result.summary.publishedViolations,
        warned: result.summary.warned,
        clean: result.summary.clean,
        byCheck: result.summary.byCheck as unknown as object,
        verdict: change.verdict,
        previousTotal: change.previous,
        total: change.current,
        // 경보를 만들었는지 그대로 남긴다 — 나중에 "왜 안 왔지"에 답해야 한다
        alerted: detected.length > 0,
        trigger,
        // 다음 실행이 "새로 위반된 것"을 가리는 근거 (결정 2701-⑤)
        violatingIds: violations.map((item) => item.contentId),
        // 표본만 남긴다 — 전량을 남기면 큰 프로젝트에서 이력이 부풀고,
        // 전체 수는 newlyCount가 말한다. 가릴 수 없었으면 **아예 남기지
        // 않는다**(NULL) — 빈 배열로 남기면 "새로 생긴 것이 없었다"로 읽힌다.
        ...(diff.comparable
          ? {
              newly: diff.newly.slice(
                0,
                NEW_VIOLATION_SAMPLE_LIMIT,
              ) as unknown as object,
            }
          : {}),
        // null은 "가릴 수 없었다" — 0("새로 생긴 것이 없다")과 다르다
        newlyCount: diff.comparable ? diff.newly.length : null,
        resolvedCount: diff.comparable ? diff.resolvedCount : null,
      },
    })) as ScanRunRow;

    if (change.verdict === "increased") {
      this.logger.warn(`${scope} — ${detail}`);
    } else {
      this.logger.log(`${scope} — ${detail}`);
    }

    return {
      outcome: {
        run: this.toDto(row),
        alerts: detected.map((alert) => ({
          key: alert.key,
          level: alert.level,
          title: alert.title,
        })),
      },
      detected,
      shouldSync: shouldSyncScanAlerts(change),
    };
  }

  /** 실행 이력 — 최신순. 범위별로 나눠 본다 */
  async history(
    options: { scope?: string; limit?: number } = {},
  ): Promise<GovernanceScanRunDto[]> {
    const rows = (await this.prisma.governanceScanRun.findMany({
      where: options.scope ? { scope: options.scope } : {},
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 20,
    })) as ScanRunRow[];
    return rows.map((row) => this.toDto(row));
  }

  /**
   * 직전 실행 — 없으면 `null`(첫 스캔).
   *
   * **경보를 만들지 않은 실행도 기준이 된다.** 경보를 낸 실행만 기준으로
   * 삼으면, 늘었다가 줄어든 뒤 다시 늘 때 "늘었다"를 놓친다.
   */
  private async previousRun(scope: string): Promise<{
    totals: ScanTotals;
    /** 그 실행이 남긴 위반 목록 — 남기지 않았으면 `null` */
    violatingIds: string[] | null;
  } | null> {
    const row = (await this.prisma.governanceScanRun.findFirst({
      where: { scope },
      orderBy: { createdAt: "desc" },
    })) as ScanRunRow | null;
    if (!row) {
      return null;
    }
    return {
      totals: {
        blocked: row.blocked,
        publishedViolations: row.publishedViolations,
        scanned: row.scanned,
      },
      violatingIds: parseIds(row.violatingIds),
    };
  }

  /** 경보·이력 문구에 쓸 프로젝트 이름 — id만 보여 주면 조치로 이어지지 않는다 */
  private async projectNames(): Promise<Record<string, string>> {
    const rows = (await this.prisma.project.findMany({
      select: { id: true, name: true },
    })) as { id: string; name: string }[];
    return Object.fromEntries(rows.map((row) => [row.id, row.name]));
  }

  private toDto(row: ScanRunRow): GovernanceScanRunDto {
    const totals: ScanTotals = {
      blocked: row.blocked,
      publishedViolations: row.publishedViolations,
      scanned: row.scanned,
    };
    const change = {
      verdict: row.verdict as ReturnType<typeof compareScan>["verdict"],
      previous: row.previousTotal,
      current: row.total,
      delta:
        row.previousTotal === null
          ? 0
          : Math.max(0, row.total - row.previousTotal),
    };
    const newly = parseNewly(row.newly);
    // 저장된 값에서 대조 결과를 되살린다 — 문구를 저장하지 않고 매번 같은
    // 함수로 만든다(판정과 설명이 어긋나지 않게). `newly`는 표본이므로
    // **건수는 저장된 전체 수**를 쓴다.
    const diff: ViolationDiff = {
      newly,
      newlyCount: row.newlyCount ?? 0,
      resolvedCount: row.resolvedCount ?? 0,
      comparable: row.newlyCount !== null,
    };

    return {
      id: row.id,
      scope: row.scope,
      summary: {
        scanned: row.scanned,
        blocked: row.blocked,
        publishedViolations: row.publishedViolations,
        warned: row.warned,
        clean: row.clean,
        byCheck: (row.byCheck ?? []) as PreflightSummaryDto["byCheck"],
      },
      verdict: change.verdict,
      previousTotal: row.previousTotal,
      total: row.total,
      alerted: row.alerted,
      trigger: row.trigger,
      newlyCount: row.newlyCount,
      newly,
      resolvedCount: row.resolvedCount,
      detail: describeScanRun(change, totals, diff),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function parseIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) {
    return null; // 목록을 남기지 않은 실행 — "위반이 없었다"와 다르다
  }
  return raw.filter((value): value is string => typeof value === "string");
}

function parseNewly(raw: unknown): ViolatingContent[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter(
      (value): value is ViolatingContent =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as ViolatingContent).contentId === "string",
    )
    .map((value) => ({
      contentId: value.contentId,
      title: typeof value.title === "string" ? value.title : "",
      contentStatus: value.contentStatus,
    }));
}
