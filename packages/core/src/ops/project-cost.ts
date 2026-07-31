/**
 * 프로젝트별 운영 비용. (TASK-4201, Sprint 42 — CTO 정책 4201-④)
 *
 * "어느 프로젝트가 돈을 쓰는가"는 네 스프린트째 답할 수 없던 질문입니다.
 * 비용은 Provider별·모델별로만 집계됐고, 그건 **누가 썼는지가 아니라
 * 무엇을 썼는지**입니다.
 *
 * ## 이 기능이 거짓말하는 방식은 하나입니다: 미배분을 나누는 것
 *
 * 실행 기록에는 프로젝트가 안 붙은 것이 많습니다 — 이 칸을 이번에 만들었고,
 * **옛 기록은 전부 null**입니다. 그리고 진단 호출·스모크처럼 애초에
 * 프로젝트가 없는 호출도 있습니다.
 *
 * 이때 가장 하기 쉬운 일은 미배분 금액을 **프로젝트별 비율로 나눠 얹는
 * 것**입니다. 그러면 합계가 맞고 표가 깔끔해집니다. 그러면 안 됩니다 —
 * **배분할 수 없는 것을 배분하면 그 숫자는 관측이 아니라 만들어낸
 * 것입니다.** 그리고 그 숫자로 팀에 비용을 청구하게 됩니다.
 *
 * 그래서 미배분은 **자기 칸에 그대로 둡니다.** 비율도 미배분을 포함한
 * 전체를 분모로 씁니다 — 미배분을 빼고 나누면 각 프로젝트의 몫이 실제보다
 * 커 보입니다.
 *
 * ## 미산정과 미배분은 다릅니다
 *
 * - **미산정**(`unpriced`): 가격표에 없는 모델이라 **금액을 모른다.**
 *   (TASK-3001에서 세운 것)
 * - **미배분**(`unattributed`): 금액은 아는데 **누구 것인지 모른다.**
 *
 * 둘을 한 칸에 넣으면 "얼마인지 모르는 것"과 "누구 것인지 모르는 것"이
 * 섞이고, 그러면 어느 쪽을 고쳐야 하는지 알 수 없습니다.
 */

/**
 * 프로젝트가 있을 수 없는 호출 기능 (TASK-4301, 정책 4301-②).
 *
 * `dev`는 개발용 API(`POST /llm/complete`)입니다 — 프로젝트 맥락 없이
 * 부르는 호출이라 **애초에 주인이 없습니다.** 이것을 "귀속 누락"으로 세면
 * 귀속률은 아무리 배선을 고쳐도 100%에 닿지 않고, **닿지 않는 지표는 곧
 * 아무도 안 봅니다.** 그래서 "주인을 못 찾은 것"과 "주인이 없는 것"을
 * 가릅니다 — 미산정과 미배분을 가른 것과 같은 이유입니다.
 *
 * 다만 **금액에서는 빼지 않습니다.** 청구서의 합계는 이것을 포함해야
 * 합니다.
 */
export const UNATTRIBUTABLE_FEATURES = ["dev"] as const;

/**
 * 이 호출에 프로젝트가 있어야 하는가.
 *
 * **모르면 `true`입니다** — 기능을 모르는 기록을 "주인이 없는 것"으로
 * 옮기면 귀속률이 저절로 좋아집니다. 모르는 것을 좋은 쪽으로 세지 않는다는
 * 규칙은 여기서도 같습니다.
 */
export function isAttributableFeature(feature: string | null): boolean {
  return (
    feature === null ||
    !(UNATTRIBUTABLE_FEATURES as readonly string[]).includes(feature)
  );
}

/** 집계 입력 한 줄 — 실행 기록 하나 */
export interface CostRecord {
  /** 프로젝트 id — 모르면 null (**공용이라는 뜻이 아니다**) */
  projectId: string | null;
  source: "llm" | "ocr";
  /** 예상 비용(USD) — 가격표에 없으면 null */
  cost: number | null;
  /** 이 호출이 진단·스모크였는가 — 프로젝트 비용이 아니다 */
  diagnostic: boolean;
  /**
   * 호출 기능 (TASK-4301). OCR처럼 기능 구분이 없으면 null이며, null은
   * **프로젝트가 있어야 하는 호출**로 봅니다 — 모르는 것을 "주인이 없는
   * 것"으로 옮기면 귀속률이 저절로 좋아집니다.
   */
  feature?: string | null;
  /** 언제 만들어진 기록인가 (ms) — 최근 창 귀속률을 내는 데 쓴다 */
  at?: number;
}

export interface ProjectCostRow {
  projectId: string;
  name: string;
  cost: number;
  calls: number;
  /** 금액을 모르는 호출 수 — 이 프로젝트의 비용은 **최소값**이다 */
  unpricedCalls: number;
  /** 전체(미배분 포함) 대비 비율 — 전체가 0이면 null */
  share: number | null;
}

export interface ProjectCostReport {
  rows: ProjectCostRow[];
  /** 프로젝트에 귀속된 금액 */
  attributed: number;
  /**
   * 귀속되지 않은 금액 — **나누지 않습니다.**
   * 배분할 수 없는 것을 배분하면 그 숫자는 만들어낸 것입니다.
   */
  unattributed: number;
  /** 진단·스모크 — 애초에 프로젝트 비용이 아니다 */
  diagnostic: number;
  /**
   * 프로젝트가 있을 수 없는 호출(개발용 API)의 금액 (TASK-4301).
   * **미배분과 다릅니다** — 이것은 누락이 아니라 원래 주인이 없는 것입니다.
   * 그래서 귀속률의 분모에서 빼지만, **합계에서는 빼지 않습니다.**
   */
  unattributable: number;
  unattributableCalls: number;
  total: number;
  /** 금액을 모르는 호출 수 (미배분과 다른 문제다) */
  unpricedCalls: number;
  /** 귀속되지 않은 호출 수 */
  unattributedCalls: number;
  /** 귀속 비율 — 전체 호출이 0이면 null */
  coverage: number | null;
  /**
   * 최근 창의 귀속률 (TASK-4301, 정책 4301-②).
   *
   * 전체 창의 귀속률은 **옛 기록 때문에 영원히 낮습니다** — 귀속 배선을
   * 오늘 고쳐도 지난 30일의 null은 그대로입니다. 그 숫자만 보면 고친 것이
   * 보이지 않고, 이 숫자만 보면 청구서가 틀렸다는 사실이 가려집니다.
   * **그래서 둘 다 냅니다.**
   *
   * 표본이 없으면 `null`입니다 — 0건을 100%로 계산하면 아무 호출도 없는
   * 환경이 가장 잘한 환경이 됩니다.
   */
  recentCoverage: number | null;
  /** 최근 창에서 귀속 대상이었던 호출 수 */
  recentCalls: number;
  recentWindowHours: number;
  windowDays: number;
  detail: string;
  /** 이 숫자를 어떻게 읽어야 하는지 (항상 붙는다) */
  caveat: string;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * 프로젝트별 비용을 집계한다 (순수 함수, CTO 정책 4201-④).
 *
 * `names`에 없는 프로젝트 id는 id를 그대로 이름으로 씁니다 — 지워진
 * 프로젝트의 비용도 **사라지면 안 되기** 때문입니다.
 */
export function summarizeProjectCost(input: {
  records: CostRecord[];
  names: Record<string, string>;
  windowDays: number;
  /** 최근 창 (기본 24시간) — 지금 들어오는 기록의 귀속률을 따로 본다 */
  recentWindowHours?: number;
  now?: number;
}): ProjectCostReport {
  const byProject = new Map<string, { cost: number; calls: number; unpriced: number }>();
  let unattributed = 0;
  let unattributedCalls = 0;
  let diagnostic = 0;
  let unattributable = 0;
  let unattributableCalls = 0;
  let unpricedCalls = 0;
  let attributed = 0;
  let projectCalls = 0;
  let recentCalls = 0;
  let recentAttributed = 0;

  const recentWindowHours = input.recentWindowHours ?? 24;
  const recentSince =
    input.now === undefined ? null : input.now - recentWindowHours * 3_600_000;

  for (const row of input.records) {
    const amount = row.cost ?? 0;
    if (row.cost === null) {
      unpricedCalls += 1;
    }

    if (row.diagnostic) {
      // 진단·스모크는 프로젝트 비용이 아니다 — 미배분과도 다르다
      diagnostic += amount;
      continue;
    }

    if (!isAttributableFeature(row.feature ?? null)) {
      // **주인이 없는 것**은 주인을 못 찾은 것과 다르다 (TASK-4301).
      // 금액에는 그대로 들어가고, 귀속률의 분모에서만 빠진다.
      unattributable += amount;
      unattributableCalls += 1;
      continue;
    }

    // 최근 창은 **귀속 대상 호출만** 센다 — 개발용 호출을 넣으면 최근
    // 귀속률이 배선과 무관하게 흔들린다
    const inRecent =
      recentSince !== null && row.at !== undefined && row.at >= recentSince;
    if (inRecent) {
      recentCalls += 1;
      if (row.projectId !== null) {
        recentAttributed += 1;
      }
    }

    if (row.projectId === null) {
      unattributed += amount;
      unattributedCalls += 1;
      continue;
    }

    const bucket = byProject.get(row.projectId) ?? { cost: 0, calls: 0, unpriced: 0 };
    bucket.cost += amount;
    bucket.calls += 1;
    if (row.cost === null) {
      bucket.unpriced += 1;
    }
    byProject.set(row.projectId, bucket);
    attributed += amount;
    projectCalls += 1;
  }

  // **미배분을 포함한 전체**가 분모다 — 빼고 나누면 각 프로젝트의 몫이
  // 실제보다 커 보인다. 주인이 없는 호출(개발용)도 청구서에는 들어가므로
  // 합계에서 빼지 않는다.
  const total = round(attributed + unattributed + diagnostic + unattributable);

  const rows: ProjectCostRow[] = [...byProject.entries()]
    .map(([projectId, bucket]) => ({
      projectId,
      name: input.names[projectId] ?? projectId,
      cost: round(bucket.cost),
      calls: bucket.calls,
      unpricedCalls: bucket.unpriced,
      share: total === 0 ? null : Math.round((bucket.cost / total) * 1000) / 10,
    }))
    .sort((a, b) => b.cost - a.cost);

  const totalCalls = projectCalls + unattributedCalls;
  const coverage =
    totalCalls === 0 ? null : Math.round((projectCalls / totalCalls) * 1000) / 10;
  // **표본이 0이면 100%가 아니라 "잴 수 없음"이다** — 아무 호출도 없는
  // 환경이 가장 잘한 환경으로 보이면 안 된다
  const recentCoverage =
    recentCalls === 0 ? null : Math.round((recentAttributed / recentCalls) * 1000) / 10;

  const parts: string[] = [
    `최근 ${input.windowDays}일 · 프로젝트 ${rows.length}개에 ` +
      `$${round(attributed).toFixed(6)} 귀속.`,
  ];
  if (unattributedCalls > 0) {
    parts.push(
      `귀속되지 않은 호출 ${unattributedCalls}건($${round(unattributed).toFixed(6)}) — ` +
        "프로젝트를 알 수 없는 기록입니다. 이 금액을 프로젝트별로 나눠 얹지 " +
        "않았습니다: 배분할 수 없는 것을 배분하면 그 숫자는 관측이 아니라 " +
        "만들어낸 것이 됩니다.",
    );
  }
  if (diagnostic > 0) {
    parts.push(
      `진단·스모크 $${round(diagnostic).toFixed(6)}는 프로젝트 비용이 ` +
        "아니므로 따로 뒀습니다.",
    );
  }
  if (unpricedCalls > 0) {
    // **미산정과 미배분을 가른다** — 앞은 금액을 모르는 것이고 뒤는 주인을
    // 모르는 것이다
    parts.push(
      `금액을 낼 수 없는 호출 ${unpricedCalls}건이 있습니다(가격표에 없는 ` +
        "모델) — 위 금액은 모두 최소값입니다. 이것은 주인을 모르는 것과 " +
        "다른 문제입니다.",
    );
  }
  if (unattributableCalls > 0) {
    parts.push(
      `개발용 호출 ${unattributableCalls}건($${round(unattributable).toFixed(6)})은 ` +
        "프로젝트가 있을 수 없는 호출이라 귀속률에서 뺐습니다 — 다만 " +
        "합계에는 그대로 들어 있습니다. 주인을 못 찾은 것과 주인이 없는 " +
        "것은 다릅니다.",
    );
  }
  if (recentCoverage !== null && coverage !== null && recentCoverage > coverage) {
    parts.push(
      `최근 ${recentWindowHours}시간에 들어온 기록의 귀속률은 ` +
        `${recentCoverage}%입니다(${recentCalls}건 기준) — 지난 기록은 ` +
        "고칠 수 없으므로 전체 귀속률은 천천히 따라옵니다.",
    );
  } else if (recentCoverage === null) {
    parts.push(
      `최근 ${recentWindowHours}시간에는 귀속 대상 호출이 없어 지금 ` +
        "들어오는 기록의 귀속률을 잴 수 없습니다.",
    );
  }
  if (rows.length === 0 && unattributedCalls === 0 && diagnostic === 0) {
    parts.push("이 기간에 과금된 호출이 없습니다.");
  }

  return {
    rows,
    attributed: round(attributed),
    unattributed: round(unattributed),
    diagnostic: round(diagnostic),
    unattributable: round(unattributable),
    unattributableCalls,
    total,
    unpricedCalls,
    unattributedCalls,
    coverage,
    recentCoverage,
    recentCalls,
    recentWindowHours,
    windowDays: input.windowDays,
    detail: parts.join(" "),
    caveat:
      coverage === null
        ? "표본이 없어 귀속률을 낼 수 없습니다."
        : coverage < 100
          ? `귀속률 ${coverage}% — 나머지는 프로젝트를 알 수 없는 기록이고, ` +
            "그 금액은 어느 프로젝트에도 더해지지 않았습니다. 이 표로 비용을 " +
            "청구한다면 실제 사용량보다 적게 청구됩니다."
          : "이 기간의 모든 과금 호출이 프로젝트에 귀속됐습니다.",
  };
}

/**
 * 귀속률이 낮은 것을 경보로 (순수 함수).
 *
 * **금액이 크다고 경보하지 않습니다** — 많이 쓰는 것은 문제가 아니고,
 * 그건 예산 경보(TASK-1302)가 이미 봅니다. 여기서 알리고 싶은 것은
 * **"이 표를 믿을 수 없다"** 입니다: 귀속률이 낮으면 프로젝트별 비용은
 * 있으나 마나입니다.
 */
export function detectAttributionAlerts(
  report: ProjectCostReport,
  input: { alerting: boolean; minCoverage: number; minSample?: number },
): {
  kind: "cost-forecast";
  key: string;
  level: "warning";
  title: string;
  message: string;
}[] {
  if (!input.alerting) {
    return [];
  }
  /**
   * **최근 창을 봅니다** (TASK-4301에서 바꿈).
   *
   * 전체 창의 귀속률은 옛 기록 때문에 몇 주 동안 낮게 남습니다. 그것으로
   * 매일 경보하면, 배선을 이미 고쳤는데도 같은 경보가 계속 오고 **그 경보는
   * 곧 무시됩니다.** 여기서 알리고 싶은 것은 "지금 들어오는 기록이 주인
   * 없이 쌓이고 있다"이고, 그것은 고칠 수 있는 사실입니다.
   *
   * 잴 수 없으면(표본 0) 경보하지 않습니다 — 다만 보고서는 잴 수 없다고
   * 말합니다. 모르는 것을 통과로 적지 않되, 모른다고 울리지도 않습니다.
   */
  if (report.recentCoverage === null || report.recentCoverage >= input.minCoverage) {
    return [];
  }
  /**
   * **표본이 적으면 부르지 않습니다** (TASK-4401, 라이브 검증에서 고침).
   *
   * 목표 판정은 최소 표본을 요구하는데(`analyzeAttributionGap`) 경보는 안
   * 그랬습니다. 그래서 호출 7건짜리 창에서 화면은 "표본 부족 — 판정 보류"
   * 라고 말하고 경보는 "목표 미달"이라고 사람을 깨웠습니다. **같은 사실에
   * 두 개의 답**이고, 둘이 어긋나는 순간 사람은 둘 다 안 믿습니다.
   *
   * 표본이 모자라 판정하지 않은 것을 경보로 만들지 않습니다 — 다만 보고서는
   * 계속 "잴 수 없다"고 말합니다(조용해지는 것과 다릅니다).
   */
  const minSample = input.minSample ?? 0;
  if (report.recentCalls < minSample) {
    return [];
  }
  return [
    {
      kind: "cost-forecast",
      key: "cost-attribution:coverage",
      // 차단이 아니다 — 비용은 계속 나가고, 우리가 모르는 것은 표의 정확도다
      level: "warning",
      title: `프로젝트 비용 귀속률 ${report.recentCoverage}% (최근 ${report.recentWindowHours}시간)`,
      message:
        `최근 ${report.recentWindowHours}시간에 들어온 귀속 대상 호출 ` +
        `${report.recentCalls}건 중 ${report.recentCoverage}%만 프로젝트에 ` +
        `귀속됐습니다. 최근 ${report.windowDays}일 전체로는 ` +
        `${report.coverage ?? "-"}%(미귀속 ${report.unattributedCalls}건 · ` +
        `$${report.unattributed.toFixed(6)})입니다. 미귀속 금액을 프로젝트에 ` +
        "나눠 얹지 않으므로, 지금 이 표로 비용을 청구하면 실제보다 적게 " +
        "청구됩니다. 호출 경로에 프로젝트가 전달되는지 확인해 주세요.",
    },
  ];
}
