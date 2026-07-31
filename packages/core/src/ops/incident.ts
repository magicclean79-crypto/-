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
}

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
  return { ok: true };
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

  return {
    open,
    resolvedCount: resolved.length,
    mttrMs,
    mttdMs,
    longest,
    totalDowntimeMs: resolved.reduce((sum, item) => sum + item.duration.ms, 0),
    withoutCause,
    detail: parts.join(" "),
  };
}
