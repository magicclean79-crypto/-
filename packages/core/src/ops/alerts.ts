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

// ── 중복·해소 판정 ───────────────────────────────────────────

export interface ReconcileOptions {
  /** 같은 경보를 다시 알리기까지의 최소 간격 (ms) */
  cooldownMs: number;
  /** 종류별 간격 (CTO 결정 1302-①) — 없는 종류는 cooldownMs를 쓴다 */
  cooldownByKind?: Partial<Record<AlertKind, number>>;
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

  for (const state of states) {
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
  budget: "ALERT_COOLDOWN_BUDGET_MS",
  "provider-failure": "ALERT_COOLDOWN_PROVIDER_MS",
  "unpriced-model": "ALERT_COOLDOWN_UNPRICED_MS",
  configuration: "ALERT_COOLDOWN_CONFIG_MS",
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
