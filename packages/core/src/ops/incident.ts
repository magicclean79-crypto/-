/**
 * 운영 장애 이력. (TASK-3701, Sprint 37 — CTO 정책 3701-④)
 *
 * ## 경보와 장애는 다르다
 *
 * 우리에겐 이미 경보(`Alert`)가 있습니다. 경보는 **신호**입니다 — 자동으로
 * 뜨고, 자주 뜨고, 상당수는 아무 일도 아닙니다. 장애는 **사람이 선언한
 * 사건**입니다: 시작이 있고 끝이 있고, 그 사이에 사용자가 무엇을 못 했는지가
 * 있습니다. 경보 100건에서 장애 이력을 자동으로 뽑아내려는 시도는 늘 둘 중
 * 하나로 끝납니다 — 아무것도 아닌 것이 장애가 되거나, 조용히 지나간 진짜
 * 장애가 빠지거나.
 *
 * 그래서 장애는 **사람이 연다.** 경보는 그 판단의 재료이지 대체물이 아닙니다.
 *
 * ## 안 끝난 장애의 지속 시간은 최종값이 아니다
 *
 * 진행 중인 장애의 "40시간"은 결과가 아니라 **지금까지**입니다. 이 둘을 같은
 * 칸에 적으면 평균이 거짓말을 합니다. 그래서 MTTR은 **복구된 장애만으로**
 * 계산하고, 진행 중인 것은 따로, 그리고 먼저 보여 줍니다 — 40시간째 열려
 * 있는 장애 하나가 좋은 MTTR보다 훨씬 중요한 사실이기 때문입니다.
 *
 * ## 복구 방법 없이 닫지 않는다
 *
 * 무엇으로 살렸는지 적히지 않은 종료 기록은 다음 장애 때 아무 도움이
 * 되지 않습니다. 그것은 이력이 아니라 숫자입니다.
 */

import { formatDuration } from "./activation-history";

export const INCIDENT_SEVERITIES = ["MINOR", "MAJOR", "CRITICAL"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

/** 장애가 닿은 곳 — 자유 문자열이 아니라 우리가 실제로 운영하는 구성 요소 */
export const INCIDENT_COMPONENTS = [
  "llm",
  "ocr",
  "storage",
  "database",
  "queue",
  "web",
  "api",
  "other",
] as const;
export type IncidentComponent = (typeof INCIDENT_COMPONENTS)[number];

export interface IncidentRecord {
  id: string;
  component: IncidentComponent;
  severity: IncidentSeverity;
  summary: string;
  /** 장애가 **시작된** 시각 — 우리가 알아챈 시각이 아니다 */
  startedAt: Date;
  /** 우리가 알아챈 시각 — 모르면 null */
  detectedAt: Date | null;
  /** 복구된 시각 — 진행 중이면 null */
  resolvedAt: Date | null;
  /** 원인 — 모르면 null. 지어내지 않는다 */
  cause: string | null;
  /** 무엇으로 살렸는가 — 복구 기록에 필수 */
  recovery: string | null;
  /**
   * 그 복구가 **임시였는가 영구였는가** (TASK-3801, CTO 정책 3801-②).
   * 닫을 때 반드시 고른다 — 이 한 칸이 "끝난 장애"와 "멈춰 둔 장애"를
   * 가른다. 옛 기록은 null(모름)이다.
   */
  fixKind: IncidentFixKind | null;
  /** 근본 원인 — 조사해서 알아낸 것. 모르면 null */
  rootCause: string | null;
  /** 임시 조치 — 지금 살리기 위해 한 일 */
  temporaryFix: string | null;
  /** 영구 조치 — 같은 원인으로 다시 나지 않게 한 일 */
  permanentFix: string | null;
  /** 재발 방지 — 절차·감시·설계에 남긴 것 */
  prevention: string | null;
  /**
   * 초안인가 확인된 장애인가 (TASK-3901, CTO 정책 3901-⑤).
   *
   * 경보에서 자동으로 만든 것은 **초안**이고, 초안은 아직 사람이 장애라고
   * 말한 적이 없습니다. 그래서 평균에 넣지 않습니다.
   */
  status: IncidentStatus;
  /** 어느 경보에서 왔는가 — 사람이 연 장애는 null */
  sourceAlertKey: string | null;
  dismissedAt: Date | null;
  dismissReason: string | null;
}

/** 장애 기록의 상태 (CTO 정책 3901-⑤) */
export const INCIDENT_STATUSES = ["DRAFT", "CONFIRMED", "DISMISSED"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/**
 * 복구의 성격 (CTO 정책 3801-②).
 *
 * **임시 조치로 닫힌 장애는 끝난 것이 아닙니다.** 재시작으로 살렸다면 그
 * 원인은 그대로 있고, 같은 일이 다음 주에 다시 납니다. 그런데 장애 목록에서
 * 그 둘은 똑같이 "복구됨"으로 보입니다 — 그러면 팀은 자기가 **몇 개의
 * 시한폭탄을 안고 있는지** 모릅니다.
 */
export const INCIDENT_FIX_KINDS = ["temporary", "permanent"] as const;
export type IncidentFixKind = (typeof INCIDENT_FIX_KINDS)[number];

/** 장애 한 건의 시간 정보 */
export interface IncidentDuration {
  /** 시작 → 복구(또는 지금) */
  ms: number;
  /** 진행 중인가 — 그렇다면 `ms`는 최종값이 아니라 지금까지다 */
  ongoing: boolean;
  /**
   * 시작 → 알아챔. 알아챈 시각을 모르면 null.
   * 이 값이 크면 "복구가 느렸다"가 아니라 **"늦게 알았다"** 이고, 고칠 곳이
   * 전혀 다릅니다.
   */
  detectionMs: number | null;
  /** 알아챔(또는 시작) → 복구 */
  recoveryMs: number | null;
  label: string;
}

/** 장애 한 건의 지속 시간 (순수 함수) */
export function incidentDuration(
  incident: IncidentRecord,
  now: Date = new Date(),
): IncidentDuration {
  const started = incident.startedAt.getTime();
  const end = incident.resolvedAt?.getTime() ?? now.getTime();
  const ms = Math.max(0, end - started);
  const detectionMs =
    incident.detectedAt === null
      ? null
      : Math.max(0, incident.detectedAt.getTime() - started);
  const recoveryMs =
    incident.resolvedAt === null
      ? null
      : Math.max(0, incident.resolvedAt.getTime() - (incident.detectedAt?.getTime() ?? started));

  return {
    ms,
    ongoing: incident.resolvedAt === null,
    detectionMs,
    recoveryMs,
    label:
      incident.resolvedAt === null
        ? `${formatDuration(ms)}째 진행 중`
        : formatDuration(ms),
  };
}

/** 새 장애 기록이 성립하는가 — 성립하지 않으면 이유를 돌려준다 */
export function validateIncident(input: {
  component: string;
  severity: string;
  summary: string;
  startedAt: Date;
  detectedAt?: Date | null;
  now?: Date;
}): { ok: true } | { ok: false; reason: string } {
  const now = input.now ?? new Date();
  if (!(INCIDENT_COMPONENTS as readonly string[]).includes(input.component)) {
    return {
      ok: false,
      reason: `모르는 구성 요소입니다: ${input.component} (${INCIDENT_COMPONENTS.join(" · ")})`,
    };
  }
  if (!(INCIDENT_SEVERITIES as readonly string[]).includes(input.severity)) {
    return {
      ok: false,
      reason: `모르는 등급입니다: ${input.severity} (${INCIDENT_SEVERITIES.join(" · ")})`,
    };
  }
  if (input.summary.trim().length < 5) {
    return {
      ok: false,
      reason:
        "무슨 일이 있었는지 한 줄로 적어 주세요 — 한 달 뒤에 읽는 사람이 " +
        "알아볼 수 없는 기록은 이력이 아닙니다.",
    };
  }
  if (Number.isNaN(input.startedAt.getTime())) {
    return { ok: false, reason: "시작 시각이 올바르지 않습니다." };
  }
  if (input.startedAt.getTime() > now.getTime() + 60_000) {
    return {
      ok: false,
      reason: "시작 시각이 미래입니다 — 아직 일어나지 않은 장애는 기록하지 않습니다.",
    };
  }
  if (
    input.detectedAt !== null &&
    input.detectedAt !== undefined &&
    input.detectedAt.getTime() < input.startedAt.getTime()
  ) {
    return {
      ok: false,
      reason: "알아챈 시각이 시작보다 앞섭니다 — 일어나기 전에 알 수는 없습니다.",
    };
  }
  return { ok: true };
}

/** 복구 기록이 성립하는가 */
export function validateResolution(input: {
  incident: IncidentRecord;
  resolvedAt: Date;
  recovery: string;
  /** 그 복구가 임시인가 영구인가 (CTO 정책 3801-②) */
  fixKind: string;
  now?: Date;
}): { ok: true } | { ok: false; reason: string } {
  const now = input.now ?? new Date();
  if (input.incident.resolvedAt !== null) {
    return { ok: false, reason: "이미 복구로 닫힌 장애입니다." };
  }
  if (Number.isNaN(input.resolvedAt.getTime())) {
    return { ok: false, reason: "복구 시각이 올바르지 않습니다." };
  }
  if (input.resolvedAt.getTime() < input.incident.startedAt.getTime()) {
    return { ok: false, reason: "복구 시각이 시작보다 앞섭니다." };
  }
  if (input.resolvedAt.getTime() > now.getTime() + 60_000) {
    return { ok: false, reason: "복구 시각이 미래입니다." };
  }
  if (input.recovery.trim().length < 5) {
    return {
      ok: false,
      reason:
        "무엇으로 살렸는지 적어 주세요 — 복구 방법이 없는 종료 기록은 다음 " +
        "장애 때 아무 도움이 되지 않습니다 (CTO 정책 3701-④).",
    };
  }
  // **임시인지 영구인지를 고르게 한다** (CTO 정책 3801-②). 기본값을 두지
  // 않는 이유: 기본값이 "영구"면 시한폭탄이 해결된 것으로 세어지고,
  // 기본값이 "임시"면 진짜 해결까지 미해결로 남아 목록이 거짓말을 한다.
  // 이건 사람만 아는 사실이므로 사람이 고른다.
  if (!(INCIDENT_FIX_KINDS as readonly string[]).includes(input.fixKind)) {
    return {
      ok: false,
      reason:
        "이 복구가 임시 조치인지 영구 조치인지 골라 주세요 " +
        `(${INCIDENT_FIX_KINDS.join(" · ")}) — 재시작으로 살린 것과 원인을 ` +
        "없앤 것이 목록에서 똑같이 '복구됨'으로 보이면, 팀은 자기가 몇 개의 " +
        "시한폭탄을 안고 있는지 모릅니다 (CTO 정책 3801-②).",
    };
  }
  return { ok: true };
}

/**
 * 사후 분석 기록이 성립하는가 (CTO 정책 3801-②).
 *
 * 장애를 닫는 것과 **원인을 알아내는 것**은 다른 일이고, 대개 다른 날에
 * 일어납니다. 그래서 분석은 따로 채웁니다.
 *
 * 여기서 막는 것 하나: **원인을 모르는데 재발 방지를 적을 수는 없습니다.**
 * 무엇이 원인인지 모르는 채 적은 재발 방지는 "무언가 했다"는 기분만 남기고,
 * 그 기분이 다음 장애 때 조사를 건너뛰게 만듭니다.
 */
export function validateAnalysis(input: {
  incident: IncidentRecord;
  rootCause?: string | null;
  permanentFix?: string | null;
  prevention?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const filled = (value: string | null | undefined): boolean =>
    typeof value === "string" && value.trim().length >= 5;

  if (
    !filled(input.rootCause) &&
    !filled(input.permanentFix) &&
    !filled(input.prevention)
  ) {
    return {
      ok: false,
      reason:
        "근본 원인 · 영구 조치 · 재발 방지 중 적어도 하나는 적어 주세요 " +
        "(각 5자 이상).",
    };
  }

  const knowsCause = filled(input.rootCause) || filled(input.incident.rootCause);
  if (filled(input.prevention) && !knowsCause) {
    return {
      ok: false,
      reason:
        "근본 원인 없이 재발 방지를 적을 수 없습니다 — 무엇이 원인인지 " +
        "모르는 채 적은 재발 방지는 다음 장애 때 조사를 건너뛰게 만듭니다 " +
        "(CTO 정책 3801-②).",
    };
  }
  return { ok: true };
}

/**
 * 이 장애가 **아직 끝나지 않았는가** (순수 함수, CTO 정책 3801-②).
 *
 * 복구로 닫혔더라도 임시 조치였다면 원인은 그대로 있습니다. 영구 조치가
 * 적히면 그때 비로소 끝난 것으로 봅니다.
 */
export function needsFollowUp(incident: IncidentRecord): boolean {
  if (incident.resolvedAt === null) {
    return false; // 진행 중인 장애는 '후속'이 아니라 '지금'이다
  }
  if ((incident.permanentFix ?? "").trim() !== "") {
    return false;
  }
  return incident.fixKind === "temporary";
}

export interface IncidentSummary {
  /** 진행 중인 장애 — 먼저 본다 */
  open: { incident: IncidentRecord; duration: IncidentDuration }[];
  resolvedCount: number;
  /**
   * 평균 복구 시간 — **복구된 장애만으로** 계산한다.
   * 복구된 것이 하나도 없으면 `null`이다: 0분은 "빨랐다"가 아니라 "모른다"다.
   */
  mttrMs: number | null;
  /**
   * 평균 감지 시간 — 알아챈 시각이 적힌 장애만으로 계산한다.
   * 이 값이 크면 고칠 곳은 복구 절차가 아니라 **감시**다.
   */
  mttdMs: number | null;
  /** 가장 오래 걸린 장애 */
  longest: { incident: IncidentRecord; duration: IncidentDuration } | null;
  /** 복구된 장애의 총 지속 시간 합 */
  totalDowntimeMs: number;
  /** 원인이 적히지 않은 채 닫힌 장애 수 — 이력의 구멍이다 */
  withoutCause: number;
  /**
   * **임시 조치로 닫혀 영구 조치를 기다리는 장애** (CTO 정책 3801-②).
   * 목록에서는 "복구됨"으로 보이지만 원인은 그대로 있습니다.
   */
  awaitingPermanentFix: IncidentRecord[];
  /** 근본 원인이 적히지 않은 채 닫힌 장애 수 */
  withoutRootCause: number;
  /** 재발 방지가 적힌 장애 수 — 이력이 다음 사람에게 남기는 것 */
  withPrevention: number;
  detail: string;
}

/** 장애 이력을 요약한다 (순수 함수) */
export function summarizeIncidents(
  incidents: IncidentRecord[],
  now: Date = new Date(),
): IncidentSummary {
  const withDuration = incidents.map((incident) => ({
    incident,
    duration: incidentDuration(incident, now),
  }));
  const open = withDuration
    .filter((item) => item.duration.ongoing)
    .sort((left, right) => right.duration.ms - left.duration.ms);
  const resolved = withDuration.filter((item) => !item.duration.ongoing);

  const mttrMs =
    resolved.length === 0
      ? null
      : Math.round(
          resolved.reduce((sum, item) => sum + item.duration.ms, 0) / resolved.length,
        );

  const detected = withDuration.filter((item) => item.duration.detectionMs !== null);
  const mttdMs =
    detected.length === 0
      ? null
      : Math.round(
          detected.reduce((sum, item) => sum + (item.duration.detectionMs ?? 0), 0) /
            detected.length,
        );

  const longest =
    withDuration.length === 0
      ? null
      : withDuration.reduce((worst, item) =>
          item.duration.ms > worst.duration.ms ? item : worst,
        );

  const parts: string[] = [];
  if (open.length > 0) {
    parts.push(
      `진행 중인 장애 ${open.length}건 — 가장 오래된 것이 ` +
        `${formatDuration(open[0].duration.ms)}째입니다(${open[0].incident.summary}). ` +
        "진행 중인 시간은 최종값이 아니며 평균에도 넣지 않습니다.",
    );
  } else if (incidents.length === 0) {
    parts.push(
      "기록된 장애가 없습니다 — 장애가 없었다는 뜻일 수도, 아무도 적지 " +
        "않았다는 뜻일 수도 있습니다. 장애는 자동으로 열리지 않습니다.",
    );
  } else {
    parts.push("진행 중인 장애가 없습니다.");
  }
  if (mttrMs !== null) {
    parts.push(`복구 ${resolved.length}건의 평균 지속 시간 ${formatDuration(mttrMs)}.`);
  } else if (incidents.length > 0) {
    parts.push("복구로 닫힌 장애가 아직 없어 평균을 낼 수 없습니다.");
  }
  if (mttdMs !== null) {
    parts.push(`평균 감지 시간 ${formatDuration(mttdMs)}.`);
  }
  const withoutCause = resolved.filter(
    (item) => (item.incident.cause ?? "").trim() === "",
  ).length;
  if (withoutCause > 0) {
    parts.push(
      `원인이 적히지 않은 채 닫힌 장애 ${withoutCause}건 — 같은 일이 다시 ` +
        "나면 처음부터 다시 조사하게 됩니다.",
    );
  }

  // 임시 조치로 닫힌 장애 (CTO 정책 3801-②) — 목록에서는 "복구됨"이지만
  // 원인은 그대로 있다. **이 숫자를 안 보여 주면 아무도 세지 않는다.**
  const awaitingPermanentFix = resolved
    .map((item) => item.incident)
    .filter(needsFollowUp);
  if (awaitingPermanentFix.length > 0) {
    parts.push(
      `임시 조치로 닫힌 장애 ${awaitingPermanentFix.length}건이 영구 조치를 ` +
        "기다립니다 — 목록에서는 '복구됨'으로 보이지만 원인은 그대로 있습니다.",
    );
  }

  const withoutRootCause = resolved.filter(
    (item) => (item.incident.rootCause ?? "").trim() === "",
  ).length;
  const withPrevention = resolved.filter(
    (item) => (item.incident.prevention ?? "").trim() !== "",
  ).length;

  return {
    open,
    resolvedCount: resolved.length,
    mttrMs,
    mttdMs,
    longest,
    totalDowntimeMs: resolved.reduce((sum, item) => sum + item.duration.ms, 0),
    withoutCause,
    awaitingPermanentFix,
    withoutRootCause,
    withPrevention,
    detail: parts.join(" "),
  };
}
