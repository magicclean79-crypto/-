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

/** 집계 입력 한 줄 — 실행 기록 하나 */
export interface CostRecord {
  /** 프로젝트 id — 모르면 null (**공용이라는 뜻이 아니다**) */
  projectId: string | null;
  source: "llm" | "ocr";
  /** 예상 비용(USD) — 가격표에 없으면 null */
  cost: number | null;
  /** 이 호출이 진단·스모크였는가 — 프로젝트 비용이 아니다 */
  diagnostic: boolean;
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
  total: number;
  /** 금액을 모르는 호출 수 (미배분과 다른 문제다) */
  unpricedCalls: number;
  /** 귀속되지 않은 호출 수 */
  unattributedCalls: number;
  /** 귀속 비율 — 전체 호출이 0이면 null */
  coverage: number | null;
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
}): ProjectCostReport {
  const byProject = new Map<string, { cost: number; calls: number; unpriced: number }>();
  let unattributed = 0;
  let unattributedCalls = 0;
  let diagnostic = 0;
  let unpricedCalls = 0;
  let attributed = 0;
  let projectCalls = 0;

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
  // 실제보다 커 보인다
  const total = round(attributed + unattributed + diagnostic);

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
  if (rows.length === 0 && unattributedCalls === 0 && diagnostic === 0) {
    parts.push("이 기간에 과금된 호출이 없습니다.");
  }

  return {
    rows,
    attributed: round(attributed),
    unattributed: round(unattributed),
    diagnostic: round(diagnostic),
    total,
    unpricedCalls,
    unattributedCalls,
    coverage,
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
  input: { alerting: boolean; minCoverage: number },
): {
  kind: "cost-forecast";
  key: string;
  level: "warning";
  title: string;
  message: string;
}[] {
  if (!input.alerting || report.coverage === null) {
    return [];
  }
  if (report.coverage >= input.minCoverage) {
    return [];
  }
  return [
    {
      kind: "cost-forecast",
      key: "cost-attribution:coverage",
      // 차단이 아니다 — 비용은 계속 나가고, 우리가 모르는 것은 표의 정확도다
      level: "warning",
      title: `프로젝트 비용 귀속률 ${report.coverage}%`,
      message:
        `최근 ${report.windowDays}일 과금 호출 중 ${report.coverage}%만 ` +
        `프로젝트에 귀속됐습니다(미귀속 ${report.unattributedCalls}건 · ` +
        `$${report.unattributed.toFixed(6)}). 미귀속 금액을 프로젝트에 나눠 ` +
        "얹지 않으므로, 지금 이 표로 비용을 청구하면 실제보다 적게 " +
        "청구됩니다. 호출 경로에 프로젝트가 전달되는지 확인해 주세요.",
    },
  ];
}
