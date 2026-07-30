/**
 * Production Alerting. (TASK-1302, Sprint 13)
 *
 * 관측 결과(예산·모니터링·비용 검증·설정 검증)를 **사람이 조치할 수 있는
 * 경보**로 바꾸는 순수 로직.
 *
 * 설계 원칙:
 * - **같은 문제는 한 번만 알린다** — `key`가 같으면 같은 경보로 보고,
 *   쿨다운 안에서는 다시 알리지 않는다. 같은 내용이 반복해서 오면 사람이
 *   경보를 무시하기 시작하고, 그 순간 경보 체계는 없는 것과 같아진다.
 * - **해소도 알린다** — 났다는 사실만 알리고 풀린 것을 알리지 않으면,
 *   지금 문제가 있는지 없는지를 알 수 없다.
 * - **판정할 수 없으면 경보하지 않는다** — 표본 부족(`unknown`)은 장애가
 *   아니다. 모르는 것을 문제라고 말하지 않는다.
 */

export const ALERT_KINDS = [
  "budget",
  "provider-failure",
  "unpriced-model",
  "configuration",
  // 예약 점검 정지 (TASK-1501, CTO 결정 1401-①)
  "scheduler-stopped",
  // 복구 리허설 (TASK-1801, CTO 결정 1701-⑤)
  "recovery-drill",
  // 백업 소요 시간 (TASK-1901, CTO 결정 1801-①)
  "backup-performance",
  // 백업 사슬·원격 사본·규모 (TASK-2001)
  "backup-integrity",
  // 스키마 거버넌스 (TASK-2401, CTO 결정 2301-②)
  "migration-governance",
  // 발행 위반 예약 스캔 (TASK-2701, CTO 결정 2601-③) — 늘었을 때만 부른다
  "governance-scan",
  // 가격 변경 감지 (TASK-3201, CTO 정책 3201-①) — 승인을 기다리는 제안이 있다
  "pricing-drift",
  // 월말 비용 예측 (TASK-3201, CTO 정책 3201-④) — **경보만** 낸다, 차단은 없다
  "cost-forecast",
  // 외부 가격 공지 (TASK-3301, CTO 정책 3301-①) — 못 읽은 것은 "변경 없음"이 아니다
  "price-source",
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];
export type AlertLevel = "warning" | "critical";

/** 감지된 경보 1건 — 저장 전의 순수 표현 */
export interface DetectedAlert {
  kind: AlertKind;
  /** 중복 판정 키 — 같은 문제면 같은 값 (예: `provider-failure:openai`) */
  key: string;
  level: AlertLevel;
  title: string;
  message: string;
}

/** 저장된 경보의 현재 상태 (중복·해소 판정 입력) */
export interface AlertState {
  key: string;
  level: AlertLevel;
  status: "ACTIVE" | "RESOLVED";
  /** 마지막으로 외부 채널에 알린 시각 (ms) — 없으면 아직 안 알림 */
  notifiedAt: number | null;
}

export type AlertAction = "raise" | "repeat" | "suppress" | "resolve";

export interface AlertDecision {
  key: string;
  action: AlertAction;
  /** 외부 채널로 알려야 하는가 */
  notify: boolean;
  alert: DetectedAlert | null;
  reason: string;
}

// ── 감지기 (관측 결과 → 경보) ────────────────────────────────

export interface BudgetWindowInput {
  budget: number | null;
  spend: number;
  ratio: number | null;
  status: string;
}

/**
 * Budget Alert — 경고 임계 도달(warning)과 예산 초과(critical).
 * 예산이 없으면(무제한) 경보하지 않는다 — 넘을 상한이 없다.
 */
export function detectBudgetAlerts(input: {
  daily: BudgetWindowInput;
  monthly: BudgetWindowInput;
  alertRatio: number;
}): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];
  const windows: [string, string, BudgetWindowInput][] = [
    ["daily", "일", input.daily],
    ["monthly", "월", input.monthly],
  ];

  for (const [name, label, window] of windows) {
    if (window.budget === null) {
      continue; // 무제한 — 넘을 상한이 없다
    }
    const percent = window.ratio === null ? 0 : Math.round(window.ratio * 1000) / 10;
    if (window.status === "exceeded") {
      alerts.push({
        kind: "budget",
        key: `budget:${name}`,
        level: "critical",
        title: `${label} 예산 초과`,
        message:
          `${label} 지출 $${window.spend.toFixed(4)} / 예산 $${window.budget} (${percent}%) — ` +
          "새 LLM 호출이 차단되고 있습니다. 예산을 올리거나 사용량을 줄이세요.",
      });
    } else if (window.status === "alert") {
      alerts.push({
        kind: "budget",
        key: `budget:${name}`,
        level: "warning",
        title: `${label} 예산 경고`,
        message:
          `${label} 지출 $${window.spend.toFixed(4)} / 예산 $${window.budget} (${percent}%) — ` +
          `경고 임계 ${Math.round(input.alertRatio * 100)}%를 넘었습니다.`,
      });
    }
  }
  return alerts;
}

export interface ProviderMonitorInput {
  provider: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  calls: number;
  successCount: number;
  successRate: number | null;
}

/**
 * Provider Failure Alert — 성공률 저하(degraded)와 사실상 중단(down).
 * **`unknown`은 경보하지 않는다** — 표본이 부족해 판정하지 않은 것이지
 * 장애가 아니다.
 */
export function detectProviderAlerts(
  providers: ProviderMonitorInput[],
): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];
  for (const row of providers) {
    if (row.status === "healthy" || row.status === "unknown") {
      continue;
    }
    const percent =
      row.successRate === null ? 0 : Math.round(row.successRate * 1000) / 10;
    alerts.push({
      kind: "provider-failure",
      key: `provider-failure:${row.provider}`,
      level: row.status === "down" ? "critical" : "warning",
      title:
        row.status === "down"
          ? `${row.provider} 사실상 중단`
          : `${row.provider} 성공률 저하`,
      message:
        `성공률 ${percent}% (${row.successCount}/${row.calls}) — ` +
        (row.status === "down"
          ? "키·할당량·Provider 장애를 확인하세요. Failover 대상 Provider가 있는지도 함께 보세요."
          : "Failover 우선순위와 모델 선택을 점검하세요."),
    });
  }
  return alerts;
}

export interface UnpricedIssueInput {
  kind: string;
  provider: string;
  model: string;
  count: number;
}

/**
 * Unpriced Model Alert — 가격표에 없는 모델 호출.
 * CTO 결정 1301-⑤에 따라 **경보만 하고 호출은 막지 않는다**
 * (막으면 안전하지만 새 모델 도입이 불가능해진다).
 */
export function detectUnpricedAlerts(
  issues: UnpricedIssueInput[],
): DetectedAlert[] {
  return issues
    .filter((issue) => issue.kind === "unpriced")
    .map((issue) => ({
      kind: "unpriced-model" as const,
      key: `unpriced-model:${issue.provider}:${issue.model}`,
      level: "warning" as const,
      title: `가격표에 없는 모델 — ${issue.model}`,
      message:
        `${issue.provider}/${issue.model} 호출 ${issue.count}건의 비용이 집계되지 않았습니다 — ` +
        "예산 상한이 이 호출들에는 적용되지 않습니다. DEFAULT_LLM_PRICING에 단가를 등록하세요. " +
        "(호출 자체는 차단하지 않습니다 — CTO 결정 1301-⑤)",
    }));
}

/**
 * Configuration Alert — 환경 검증 오류와 Provider 키 문제.
 * 기동 후에 환경이 바뀌거나(콘솔 오버라이드·키 회수) 키가 폐기되는 경우를
 * 잡는다 — 기동 시점 검증(Fail Fast)만으로는 뜬 뒤의 변화를 알 수 없다.
 */
export function detectConfigurationAlerts(input: {
  envErrors: { name: string; message: string }[];
  providerBlockers: string[];
}): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];

  for (const issue of input.envErrors) {
    alerts.push({
      kind: "configuration",
      key: `configuration:env:${issue.name}`,
      level: "critical",
      title: `설정 오류 — ${issue.name}`,
      message: `${issue.message} (기동 후 설정이 바뀌었을 수 있습니다)`,
    });
  }

  for (const blocker of input.providerBlockers) {
    // "openai: 메시지" 형태 — Provider 이름을 키로 쓴다
    const provider = blocker.split(":")[0]?.trim() || "unknown";
    alerts.push({
      kind: "configuration",
      key: `configuration:provider:${provider}`,
      level: "critical",
      title: `Provider 설정 문제 — ${provider}`,
      message: blocker,
    });
  }

  return alerts;
}

/**
 * Pricing Drift Alert — 가격 변경이 감지되어 **승인을 기다린다**.
 * (TASK-3201, CTO 정책 3201-①)
 *
 * 감지만 하고 알리지 않으면 제안이 목록에 쌓인 채 아무도 모릅니다 — 그러면
 * 자동화는 "돌고 있지만 아무 일도 하지 않는" 상태가 됩니다.
 *
 * **차단하지 않습니다.** 단가가 어긋난 것과 호출을 막는 것은 다른 일입니다
 * (결정 1301-⑤와 같은 결).
 */
export function detectPricingDriftAlerts(input: {
  /** 감지되어 제안이 만들어진 변경 */
  changes: {
    target: string;
    key: string;
    impliedPrice: { perUnitUsd: number };
    currentPrice: { perUnitUsd: number };
    samples: number;
  }[];
  /** 어긋났지만 단가를 계산할 수 없는 신호 (LLM) */
  unresolved: { target: string; key: string; provider: string; samples: number }[];
}): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];
  for (const change of input.changes) {
    alerts.push({
      kind: "pricing-drift",
      key: `pricing-drift:${change.target}:${change.key}`,
      level: "warning",
      title: `단가 변경 감지 — ${change.key}`,
      message:
        `${change.target}/${change.key} 최근 ${change.samples}건이 단위당 ` +
        `$${change.impliedPrice.perUnitUsd}를 가리킵니다 (가격표 $${change.currentPrice.perUnitUsd}). ` +
        "제안이 등록됐습니다 — 승인 후 적용해 주세요 (CTO 정책 3201-①). " +
        "감지만으로 단가가 바뀌지는 않으며, 호출을 차단하지도 않습니다.",
    });
  }
  for (const signal of input.unresolved) {
    alerts.push({
      kind: "pricing-drift",
      key: `pricing-drift:${signal.target}:${signal.key}`,
      level: "warning",
      title: `단가 어긋남 — ${signal.key}`,
      message:
        `${signal.provider}/${signal.key} ${signal.samples}건의 기록이 가격표와 어긋납니다. ` +
        "입력·출력 단가 중 어느 것이 바뀌었는지는 기록만으로 가를 수 없어 제안을 " +
        "만들지 않았습니다 — Provider 공지를 확인해 직접 제안을 내주세요.",
    });
  }
  return alerts;
}

/**
 * Price Source Alert — 외부 가격 공지를 읽지 못했다. (TASK-3301, CTO 정책 3301-①)
 *
 * **파싱 실패를 "변경 없음"으로 처리하지 않습니다.** 못 읽은 것과 바뀐 것이
 * 없는 것은 완전히 다른 사실입니다 — 조용히 지나가면 화면은 "변경 없음"으로
 * 보이고, 사람은 확인했다고 믿고, 단가는 낡은 채로 돈이 나갑니다.
 *
 * 그래서 **사람의 확인을 요구하는 경보**를 냅니다. 다만 **미구성은 실패가
 * 아니므로**(아직 안 붙인 것) 경보 문구가 그 차이를 밝힙니다.
 */
export function detectPriceSourceAlerts(input: {
  status: string;
  needsHumanCheck: boolean;
  unparsedCount: number;
  detail: string;
  /** 어느 공지인가 (TASK-3401) — 없으면 기본 소스 하나로 본다 */
  sourceId?: string;
  /**
   * 이 소스의 실패가 **언제부터** 이어졌는가 (epoch ms).
   *
   * 없으면 승격을 판정하지 않는다 — 모르는 것을 "오래됐다"고도
   * "방금이다"라고도 말하지 않는다.
   */
  failingSince?: number | null;
  now?: number;
  escalateAfterMs?: number;
}): DetectedAlert[] {
  if (!input.needsHumanCheck) {
    return [];
  }
  // 미구성은 "아직 안 붙임"이다 — 실패와 같은 무게로 부르면 진짜 실패가 묻힌다
  const unconfigured = input.status === "unconfigured";
  const sourceId = input.sourceId ?? "pricing-feed";
  const escalation = judgePriceSourceEscalation({
    status: input.status,
    failingSince: input.failingSince ?? null,
    now: input.now ?? null,
    escalateAfterMs: input.escalateAfterMs,
  });
  const scope = sourceId === "pricing-feed" ? "" : ` — ${sourceId}`;
  return [
    {
      kind: "price-source",
      // 상태별로 키를 나누지 않는다 — 같은 사안(공지를 못 본다)이 여러 경보로
      // 흩어지면 "지금 무엇이 문제인가"를 한눈에 볼 수 없다.
      // 다만 **소스별로는 나눈다**(TASK-3401): 소스마다 원인도 조치도 다르고,
      // 한 키로 묶으면 한 곳이 나아도 다른 곳의 실패가 그 뒤에 숨는다.
      key: `price-source:${sourceId}`,
      level: escalation.level,
      title:
        (unconfigured
          ? "가격 공지가 설정되지 않았습니다"
          : `가격 공지를 읽지 못했습니다 (${input.status})`) + scope,
      message:
        input.detail +
        (input.unparsedCount > 0
          ? ` 해석하지 못한 항목 ${input.unparsedCount}건은 목록에 남아 있습니다.`
          : "") +
        // 판정 문구가 이미 사람 확인을 요구하고 있으면 되풀이하지 않는다 —
        // 같은 문장이 두 번 붙으면 경보가 기계가 쓴 글처럼 읽히고, 그때부터
        // 사람은 문장을 읽지 않고 제목만 본다 (라이브 검증에서 발견)
        (input.detail.includes("직접 확인")
          ? ""
          : " 사람이 공지를 직접 확인해 주세요 (CTO 정책 3301-①).") +
        (escalation.note === null ? "" : ` ${escalation.note}`),
    },
  ];
}

/**
 * 공지 실패가 **길어지면 등급을 올린다** (TASK-3401 — CTO 결정 3301-⑥).
 *
 * 하루 넘게 못 읽고 있는데도 계속 같은 warning이 반복되면, 사람은 그것을
 * "원래 그런 경보"로 읽습니다. 그 순간 경보는 있는데 아무도 보지 않는 상태가
 * 되고, 단가는 낡은 채로 돈이 나갑니다.
 *
 * 두 가지를 지킵니다:
 *
 * 1. **미구성은 승격하지 않습니다.** 아직 안 붙인 것은 시간이 지나도 실패가
 *    되지 않습니다 — 미구성과 실패는 다릅니다. 승격하면 "붙이지 않기로 한"
 *    선택이 며칠 뒤 장애로 둔갑합니다.
 * 2. **시작 시각을 모르면 승격하지 않습니다.** 모르는 것을 "오래됐다"고
 *    말하지 않습니다.
 */
export const DEFAULT_PRICE_SOURCE_ESCALATE_MS = 24 * 60 * 60 * 1000;
export const PRICE_SOURCE_ESCALATE_ENV = "PRICE_SOURCE_ESCALATE_AFTER_MS";

export function judgePriceSourceEscalation(input: {
  status: string;
  failingSince: number | null;
  now: number | null;
  escalateAfterMs?: number;
}): { level: AlertLevel; elapsedMs: number | null; note: string | null } {
  if (input.status === "unconfigured") {
    return { level: "warning", elapsedMs: null, note: null };
  }
  if (input.failingSince === null || input.now === null) {
    return { level: "warning", elapsedMs: null, note: null };
  }
  const elapsed = input.now - input.failingSince;
  const threshold = input.escalateAfterMs ?? DEFAULT_PRICE_SOURCE_ESCALATE_MS;
  if (elapsed < threshold) {
    return { level: "warning", elapsedMs: elapsed, note: null };
  }
  const hours = Math.max(1, Math.floor(elapsed / (60 * 60 * 1000)));
  return {
    level: "critical",
    elapsedMs: elapsed,
    note:
      `이 공지를 ${hours}시간째 읽지 못하고 있습니다 — 그동안 단가 변경을 확인할 방법이 ` +
      // 마크다운 강조는 쓰지 않는다 — Slack·메일에서 별표가 그대로 보인다
      "없었습니다. 호출을 차단하지는 않지만, 공지를 직접 확인해 주세요 (CTO 결정 3301-⑥).",
  };
}

/** 승격 기준 시간을 환경변수에서 읽는다 — 잘못 적은 값은 기본값으로 돈다 */
export function resolvePriceSourceEscalateMs(
  env: Record<string, string | undefined>,
): number {
  return positiveMs(env[PRICE_SOURCE_ESCALATE_ENV], DEFAULT_PRICE_SOURCE_ESCALATE_MS);
}

/**
 * Cost Forecast Alert — 이 추세면 월 예산을 넘는다. (TASK-3201, CTO 정책 3201-④)
 *
 * **Forecast는 Alert만 발생시키며 Budget Gate에는 연결하지 않습니다.**
 * 알리는 것과 막는 것은 다릅니다: 예측으로 막으면 **아직 쓰지 않은 돈** 때문에
 * 서비스가 멈추고, 추정이 틀렸을 때 되돌릴 방법도 없습니다. 그래서 이 함수는
 * 경보를 만들고, 그 문구가 **차단하지 않는다는 사실**을 직접 말합니다.
 *
 * 표본이 부족하면(`verdict !== "projected"`) 경보하지 않습니다 — 짐작으로
 * 사람을 부르면 다음 경보도 짐작으로 취급됩니다.
 */
export function detectForecastAlerts(input: {
  verdict: string;
  projectedMonthEnd: number | null;
  projectedRatio: number | null;
  projectedExceeds: boolean;
  budget: number | null;
  observedDays: number;
}): DetectedAlert[] {
  if (
    input.verdict !== "projected" ||
    !input.projectedExceeds ||
    input.projectedMonthEnd === null ||
    input.budget === null
  ) {
    return [];
  }
  const ratio =
    input.projectedRatio === null
      ? "?"
      : `${(input.projectedRatio * 100).toFixed(0)}%`;
  return [
    {
      kind: "cost-forecast",
      // 예산 창은 월 하나뿐이므로 키도 하나다 — 모델별로 쪼개면 같은 사안이
      // 여러 경보로 흩어져 "얼마나 넘는가"를 아무도 못 본다
      key: "cost-forecast:monthly",
      level: "warning",
      title: "이 추세면 월 AI 예산을 넘습니다",
      message:
        `관측 ${input.observedDays}일 기준 월말 예상 $${input.projectedMonthEnd.toFixed(6)} / ` +
        `예산 $${input.budget} (${ratio}). ` +
        // 마크다운 강조는 쓰지 않는다 — Slack·메일에서 별표가 그대로 보인다
        "참고용 추정입니다 — 이 값으로 호출을 차단하지 않습니다 (CTO 정책 3201-④). " +
        "예산 상향 또는 사용량 조정을 검토해 주세요.",
    },
  ];
}

export interface SchedulerStateInput {
  job: string;
  /** 멈춘 것으로 판정되었는가 (core `isSchedulerStopped`) */
  stopped: boolean;
  /** 마지막 실행 (ISO) — 없으면 "실행 이력 없음" */
  lastRunAt: string | null;
  /** 간격 설명 (표시용) */
  interval: string;
}

/**
 * Scheduler Stopped Alert (TASK-1501, CTO 결정 1401-①).
 *
 * Redis 장애로 잠금을 못 잡으면 예약 점검이 아예 돌지 않는다. **단일 모드로
 * 자동 폴백하지 않기로 했으므로**(중복 실행보다 안전하다), 멈춘 사실 자체를
 * 알린다 — 조용히 안 도는 점검이 가장 위험하다.
 *
 * `lockUnavailable`이 참이면 원인을 함께 적는다. 원인을 모르면 사람이
 * 어디부터 봐야 할지 알 수 없다.
 */
export function detectSchedulerAlerts(input: {
  jobs: SchedulerStateInput[];
  /** 분산 잠금을 쓰는데 지금 사용할 수 없는가 */
  lockUnavailable: boolean;
}): DetectedAlert[] {
  const stopped = input.jobs.filter((job) => job.stopped);
  if (stopped.length === 0) {
    return [];
  }

  const cause = input.lockUnavailable
    ? "분산 잠금(Redis)을 사용할 수 없습니다 — 잠금을 못 잡으면 예약 실행이 건너뛰어집니다. " +
      "Redis 연결을 먼저 확인하세요."
    : "예약 타이머가 돌지 않거나 점검이 계속 실패하고 있습니다. 서버 로그를 확인하세요.";

  return stopped.map((job) => ({
    kind: "scheduler-stopped" as const,
    key: `scheduler-stopped:${job.job}`,
    level: "critical" as const,
    title: `예약 점검 정지 — ${job.job}`,
    message:
      `${job.interval} 주기인데 ` +
      `${job.lastRunAt ? `마지막 실행이 ${job.lastRunAt}입니다` : "실행 이력이 없습니다"}. ` +
      cause,
  }));
}

/** 분산 잠금이 지속적으로 불가한 상태 (CTO 결정 1501-②) */
export const DEFAULT_LOCK_OUTAGE_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Redis(분산 잠금) 장애가 **일정 시간 이상 지속**되면 critical을 알린다
 * (CTO 결정 1501-②).
 *
 * 짧은 끊김은 흔하고 대개 스스로 복구된다 — 그때마다 알리면 사람이 무시한다.
 * 기본 30분을 넘겨 계속되면 그때는 사람이 개입해야 하는 상황이다.
 *
 * **LLM 호출은 계속 허용된다** — 멈추는 것은 예약 점검뿐이다. 그래서 이
 * 상태가 오래가면 "비용은 나가는데 비용 점검은 멈춘" 상태가 되고,
 * 경보 문구가 그 사실을 말한다.
 */
export function detectLockOutageAlert(input: {
  /** 잠금이 불가해진 시각 (epoch ms) — 정상이면 null */
  unhealthySince: number | null;
  now: number;
  thresholdMs?: number;
}): DetectedAlert[] {
  if (input.unhealthySince === null) {
    return [];
  }
  const threshold = input.thresholdMs ?? DEFAULT_LOCK_OUTAGE_THRESHOLD_MS;
  const elapsed = input.now - input.unhealthySince;
  if (elapsed < threshold) {
    return [];
  }

  // 1분 미만이어도 "0분째"라고 하면 멈춘 사실과 설명이 어긋난다 —
  // 라이브 검증에서 짧은 한계값으로 돌려 보다 발견했다
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  return [
    {
      kind: "scheduler-stopped",
      key: "scheduler-stopped:lock",
      level: "critical",
      title: "분산 잠금(Redis) 장애 지속",
      message:
        `분산 잠금을 ${minutes}분 넘게 사용할 수 없습니다 — 예약 점검이 그동안 돌지 않았습니다. ` +
        // 마크다운 강조는 쓰지 않는다 — Slack·메일·화면에서 별표가 그대로 보인다
        "LLM 호출은 계속 허용되므로 비용은 나가는데 비용 점검은 멈춘 상태입니다. " +
        "Redis를 복구하세요.",
    },
  ];
}

// ── 중복·해소 판정 ───────────────────────────────────────────

export interface ReconcileOptions {
  /** 같은 경보를 다시 알리기까지의 최소 간격 (ms) */
  cooldownMs: number;
  /** 종류별 간격 (CTO 결정 1302-①) — 없는 종류는 cooldownMs를 쓴다 */
  cooldownByKind?: Partial<Record<AlertKind, number>>;
  /**
   * 해소를 판정할 수 있는 키 목록 (TASK-2801, CTO 결정 2701-④).
   *
   * 없으면 넘어온 상태 전체가 대상이다(기존 동작). **한 종류 안에 서로
   * 독립적인 경보가 여러 개 있을 때** 필요하다: 프로젝트별 위반 경보는
   * 같은 `kind`인데 프로젝트마다 따로 판정되므로, 프로젝트 A만 훑은
   * 실행이 프로젝트 B의 경보를 "이번에 감지되지 않았다"며 해소해 버리면
   * **B의 위반은 그대로인데 화면에서 사라진다.**
   *
   * 재알림 간격은 이미 키마다 독립이다(`AlertState.notifiedAt`이 키 단위)
   * — 해소 범위까지 키 단위로 좁히면 두 축이 모두 독립이 된다.
   */
  resolvableKeys?: readonly string[];
  now: number;
}

/**
 * 감지된 경보와 저장된 상태를 대조해 **무엇을 알릴지** 정한다.
 *
 * - `raise` — 새 경보 또는 해소됐다가 재발 → 알린다
 * - `repeat` — 계속 활성인데 쿨다운이 지남 → 다시 알린다
 * - `suppress` — 계속 활성이고 쿨다운 안 → 기록만 갱신, 알리지 않는다
 * - `resolve` — 이번에 감지되지 않음 → 해소로 처리하고 알린다
 *
 * 심각도가 올라간 경우(warning → critical)는 쿨다운과 무관하게 알린다 —
 * 상황이 나빠진 것은 새 정보다.
 */
export function reconcileAlerts(
  detected: DetectedAlert[],
  states: AlertState[],
  options: ReconcileOptions,
): AlertDecision[] {
  const stateByKey = new Map(states.map((state) => [state.key, state]));
  const decisions: AlertDecision[] = [];
  const seen = new Set<string>();

  for (const alert of detected) {
    seen.add(alert.key);
    const state = stateByKey.get(alert.key);

    if (!state || state.status === "RESOLVED") {
      decisions.push({
        key: alert.key,
        action: "raise",
        notify: true,
        alert,
        reason: state ? "해소됐던 문제가 다시 발생했습니다." : "새로 감지되었습니다.",
      });
      continue;
    }

    if (state.level !== alert.level && alert.level === "critical") {
      decisions.push({
        key: alert.key,
        action: "raise",
        notify: true,
        alert,
        reason: "심각도가 올라갔습니다 (warning → critical).",
      });
      continue;
    }

    const elapsed =
      state.notifiedAt === null ? Infinity : options.now - state.notifiedAt;
    const cooldownMs =
      options.cooldownByKind?.[alert.kind] ?? options.cooldownMs;
    if (elapsed >= cooldownMs) {
      decisions.push({
        key: alert.key,
        action: "repeat",
        notify: true,
        alert,
        reason: "문제가 계속되고 있습니다 (재알림 간격 경과).",
      });
    } else {
      decisions.push({
        key: alert.key,
        action: "suppress",
        notify: false,
        alert,
        reason: "이미 알린 경보입니다 (재알림 간격 이내).",
      });
    }
  }

  const resolvable =
    options.resolvableKeys === undefined
      ? null
      : new Set(options.resolvableKeys);

  for (const state of states) {
    // 이번 실행이 판정하지 않은 범위는 건드리지 않는다 (결정 2701-④)
    if (resolvable !== null && !resolvable.has(state.key)) {
      continue;
    }
    if (state.status === "ACTIVE" && !seen.has(state.key)) {
      decisions.push({
        key: state.key,
        action: "resolve",
        notify: true,
        alert: null,
        reason: "더 이상 감지되지 않아 해소로 처리합니다.",
      });
    }
  }

  return decisions;
}

/** 경보 목록 요약 (표시·판정용) */
export function summarizeAlerts(alerts: { level: AlertLevel }[]): {
  total: number;
  critical: number;
  warning: number;
  /** critical이 하나라도 있으면 false */
  ok: boolean;
} {
  const critical = alerts.filter((alert) => alert.level === "critical").length;
  return {
    total: alerts.length,
    critical,
    warning: alerts.length - critical,
    ok: critical === 0,
  };
}

// ── 재알림 간격 (CTO 결정 1302-①) ─────────────────────────────

/** 기본 재알림 간격 — 30분을 공식 표준으로 유지한다 */
export const DEFAULT_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

/** 종류별 재알림 간격 환경변수 — 결정 1302-①이 허용한 확장 */
export const ALERT_COOLDOWN_ENV: Record<AlertKind, string> = {
  "migration-governance": "ALERT_COOLDOWN_MIGRATION_MS",
  budget: "ALERT_COOLDOWN_BUDGET_MS",
  "provider-failure": "ALERT_COOLDOWN_PROVIDER_MS",
  "unpriced-model": "ALERT_COOLDOWN_UNPRICED_MS",
  configuration: "ALERT_COOLDOWN_CONFIG_MS",
  "scheduler-stopped": "ALERT_COOLDOWN_SCHEDULER_MS",
  // 리허설은 날 단위 사안이라 30분마다 다시 알릴 이유가 없다
  "recovery-drill": "ALERT_COOLDOWN_DRILL_MS",
  "backup-performance": "ALERT_COOLDOWN_BACKUP_PERF_MS",
  "backup-integrity": "ALERT_COOLDOWN_BACKUP_INTEGRITY_MS",
  // 예약 스캔은 늘었을 때만 부르므로 쿨다운은 재알림만 막는다
  "governance-scan": "ALERT_COOLDOWN_GOVERNANCE_SCAN_MS",
  // 단가 변경은 사람이 승인해야 사라진다 — 30분마다 부르면 소음이 된다
  "pricing-drift": "ALERT_COOLDOWN_PRICING_DRIFT_MS",
  // 예측은 하루 단위 사안이다 (권장: ALERT_COOLDOWN_FORECAST_MS=86400000)
  "cost-forecast": "ALERT_COOLDOWN_FORECAST_MS",
  // 공지를 못 읽는 상태는 사람이 고칠 때까지 이어진다
  "price-source": "ALERT_COOLDOWN_PRICE_SOURCE_MS",
};

/** 전체 기본값 환경변수 (종류별 값이 없을 때) */
export const ALERT_COOLDOWN_DEFAULT_ENV = "ALERT_COOLDOWN_MS";

function positiveMs(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  // 잘못 적은 값 때문에 경보가 폭주하는 것보다 기본값이 안전하다
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

/**
 * 종류별 재알림 간격을 해석한다.
 * `종류별 값 ?? 전체 기본값 ?? 30분` — 설정 우선순위(1201-①)와 같은 결이다.
 */
export function resolveCooldowns(
  env: Record<string, string | undefined>,
): Record<AlertKind, number> {
  const base = positiveMs(
    env[ALERT_COOLDOWN_DEFAULT_ENV],
    DEFAULT_ALERT_COOLDOWN_MS,
  );
  const result = {} as Record<AlertKind, number>;
  for (const kind of ALERT_KINDS) {
    result[kind] = positiveMs(env[ALERT_COOLDOWN_ENV[kind]], base);
  }
  return result;
}
