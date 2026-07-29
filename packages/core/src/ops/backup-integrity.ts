/**
 * Enterprise Backup Integrity Platform. (TASK-2001, Sprint 20)
 *
 * TASK-1901까지는 **개별 백업**을 봤다 — 마지막 것이 온전한가, 얼마나
 * 걸렸는가. 이번 모듈이 보는 것은 그 위의 층이다:
 *
 * - **사슬**: 백업이 1시간마다 돈다면 지난 24시간에 24개가 있어야 한다.
 *   19개뿐이라면 어딘가 5시간이 비어 있고, 그 구간으로는 되돌아갈 수 없다.
 *   개별 백업은 전부 "성공"인데도 그렇다.
 * - **원격 사본**: 올렸다는 기록과 **거기 있는 것이 같은 파일인지**는 다르다.
 * - **규모**: 기준값은 지금 데이터 크기에서 정한 것이다. 데이터가 커지면
 *   그 기준을 다시 재야 한다 — 시스템이 그 시점을 알려 줘야 한다.
 */

import type { DrStatus } from "./disaster-recovery";
import type { DetectedAlert } from "./alerts";

// ── 백업 사슬 연속성 ─────────────────────────────────────────

export interface ChainRecordInput {
  ok: boolean;
  createdAt: number;
}

export interface BackupChain {
  status: DrStatus;
  detail: string;
  /** 관측 창 안에 있어야 할 백업 수 */
  expected: number;
  /** 실제 성공한 백업 수 */
  actual: number;
  /** 가장 긴 공백 (ms) — 되돌아갈 수 없는 구간 */
  longestGapMs: number | null;
  /** 공백이 시작된 시각 — 없으면 null */
  gapStartedAt: number | null;
  windowMs: number;
}

/** 관측 창 기본값 — 하루치를 본다 */
export const DEFAULT_CHAIN_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 공백으로 세기 시작하는 배수 — 간격의 2배를 넘으면 한 번 걸렀다는 뜻이다.
 * 1배로 두면 몇 초의 지연도 공백이 되어 늘 경보가 난다.
 */
export const DEFAULT_CHAIN_GAP_FACTOR = 2;

function hours(ms: number): string {
  if (ms >= 60 * 60 * 1000) {
    return `${(ms / (60 * 60 * 1000)).toFixed(1)}시간`;
  }
  // 20초짜리 공백을 "0분"이라 쓰면 공백이 없다는 뜻으로 읽힌다
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}초`;
  }
  return `${Math.round(ms / 60_000)}분`;
}

/**
 * 백업 사슬 판정.
 *
 * **개별 백업이 모두 성공이어도 사슬은 끊길 수 있다** — 서버가 멈춰 있던
 * 동안에는 실패 기록조차 남지 않기 때문이다. 실패는 이력에 남지만 **안 돈 것은
 * 아무 데도 남지 않는다.** 그래서 있어야 할 개수와 실제 개수를 비교한다.
 *
 * 관측 창보다 이력이 짧으면(방금 도입한 경우) 판정하지 않는다 — 처음 켠 서버를
 * "사슬이 끊겼다"고 말할 수는 없다.
 */
export function judgeBackupChain(
  records: ChainRecordInput[],
  options: {
    now: number;
    intervalMs: number;
    windowMs?: number;
    gapFactor?: number;
    /** 서버가 처음 뜬 시각 — 이보다 앞은 없어도 정상이다 */
    startedAt?: number;
  },
): BackupChain {
  const windowMs = options.windowMs ?? DEFAULT_CHAIN_WINDOW_MS;
  const gapFactor = options.gapFactor ?? DEFAULT_CHAIN_GAP_FACTOR;
  // 기동 전에 이미 백업이 돌던 시스템이라면, 꺼져 있던 동안의 공백은 **진짜
  // 공백이다** — 그 구간으로는 되돌아갈 수 없다. 기동 시각으로 창을 잘라 내면
  // 재기동이 사슬 공백을 지워 버린다(라이브 검증에서 드러난 결함).
  // 기동 시각 기준으로 자르는 것은 **이력이 전혀 없는 첫 도입**일 때만이다.
  const ranBeforeStart =
    options.startedAt !== undefined &&
    records.some(
      (entry) => entry.ok && entry.createdAt < (options.startedAt as number),
    );
  const windowStart = ranBeforeStart
    ? options.now - windowMs
    : Math.max(
        options.now - windowMs,
        options.startedAt ?? Number.NEGATIVE_INFINITY,
      );
  const observedMs = options.now - windowStart;

  const inWindow = records
    .filter((entry) => entry.ok && entry.createdAt >= windowStart)
    .sort((a, b) => a.createdAt - b.createdAt);

  const expected = Math.max(1, Math.floor(observedMs / options.intervalMs));

  // 관측 구간이 간격의 2배도 안 되면 판정할 표본이 없다
  if (observedMs < options.intervalMs * 2) {
    return {
      status: "manual",
      detail:
        "관측 구간이 짧아 백업 사슬을 판정할 수 없습니다 — 간격의 2배 이상 쌓이면 판정합니다.",
      expected,
      actual: inWindow.length,
      longestGapMs: null,
      gapStartedAt: null,
      windowMs,
    };
  }

  if (inWindow.length === 0) {
    return {
      status: "fail",
      detail:
        `최근 ${hours(observedMs)} 동안 성공한 백업이 하나도 없습니다 — ` +
        "그 구간으로는 되돌아갈 수 없습니다.",
      expected,
      actual: 0,
      longestGapMs: observedMs,
      gapStartedAt: windowStart,
      windowMs,
    };
  }

  // 창 시작 ~ 첫 백업, 백업 사이, 마지막 백업 ~ 지금
  let longestGapMs = inWindow[0].createdAt - windowStart;
  let gapStartedAt = windowStart;
  for (let index = 1; index < inWindow.length; index += 1) {
    const gap = inWindow[index].createdAt - inWindow[index - 1].createdAt;
    if (gap > longestGapMs) {
      longestGapMs = gap;
      gapStartedAt = inWindow[index - 1].createdAt;
    }
  }
  const tailGap = options.now - inWindow[inWindow.length - 1].createdAt;
  if (tailGap > longestGapMs) {
    longestGapMs = tailGap;
    gapStartedAt = inWindow[inWindow.length - 1].createdAt;
  }

  const threshold = options.intervalMs * gapFactor;
  if (longestGapMs > threshold) {
    return {
      status: "fail",
      detail:
        `백업 사슬에 ${hours(longestGapMs)} 공백이 있습니다 ` +
        `(최근 ${hours(observedMs)}에 ${inWindow.length}/${expected}회). ` +
        "그 구간은 복구할 수 없습니다 — 개별 백업이 모두 성공이어도, " +
        "돌지 않은 백업은 아무 데도 기록되지 않습니다.",
      expected,
      actual: inWindow.length,
      longestGapMs,
      gapStartedAt,
      windowMs,
    };
  }

  return {
    status: "pass",
    detail:
      `최근 ${hours(observedMs)}에 ${inWindow.length}/${expected}회 · ` +
      `최대 공백 ${hours(longestGapMs)} (한계 ${hours(threshold)}).`,
    expected,
    actual: inWindow.length,
    longestGapMs,
    gapStartedAt,
    windowMs,
  };
}

export function detectBackupChainAlert(chain: BackupChain): DetectedAlert[] {
  if (chain.status !== "fail") {
    return [];
  }
  return [
    {
      kind: "backup-integrity",
      key: "backup-integrity:chain",
      level: "critical",
      title: "백업 사슬 공백",
      message: chain.detail,
    },
  ];
}

// ── 원격 사본 무결성 ─────────────────────────────────────────

export type RemoteVerdict = "ok" | "mismatch" | "missing" | "unchecked";

export interface RemoteCheckInput {
  /** 원격에서 실제로 받아 계산한 체크섬 — 받지 못했으면 null */
  remoteChecksum: string | null;
  /** 기록된 체크섬 */
  recordedChecksum: string | null;
  /** 원격에 객체가 있었는가 */
  found: boolean;
}

export interface RemoteIntegrity {
  verdict: RemoteVerdict;
  status: DrStatus;
  detail: string;
}

/**
 * 원격 사본 무결성 판정 (CTO 결정 1701-④ 후속).
 *
 * **"올렸다"는 기록과 "거기 있는 것이 같은 파일"인 것은 다르다.** 업로드가
 * 잘렸거나 나중에 덮어써졌을 수 있고, 그 사실은 내려받아 비교해 보기 전까지
 * 알 수 없다.
 *
 * 확인하지 않은 상태(`unchecked`)는 **통과가 아니다** — 다만 실패도 아니다.
 * 내려받기는 전송 비용이 들어 기본으로 돌리지 않는다.
 */
export function judgeRemoteIntegrity(
  input: RemoteCheckInput | null,
): RemoteIntegrity {
  if (input === null) {
    return {
      verdict: "unchecked",
      status: "manual",
      detail:
        "원격 사본을 내려받아 대조하지 않았습니다 — 전송 비용이 들어 기본으로 " +
        "돌리지 않습니다. 필요할 때 수동으로 확인하세요.",
    };
  }

  if (!input.found) {
    return {
      verdict: "missing",
      status: "fail",
      detail:
        "원격에 사본이 없습니다 — 올렸다고 기록됐지만 실제로는 없습니다. " +
        "저장소 수명 주기 정책이나 삭제 여부를 확인하세요.",
    };
  }

  if (
    input.remoteChecksum === null ||
    input.recordedChecksum === null ||
    input.remoteChecksum !== input.recordedChecksum
  ) {
    return {
      verdict: "mismatch",
      status: "fail",
      detail:
        "원격 사본이 기록된 체크섬과 다릅니다 — 업로드가 잘렸거나 나중에 " +
        "덮어써졌을 수 있습니다. 이 사본으로는 복구를 장담할 수 없습니다.",
    };
  }

  return {
    verdict: "ok",
    status: "pass",
    detail: `원격 사본을 내려받아 대조했습니다 — SHA-256 일치 (${input.remoteChecksum.slice(0, 12)}…).`,
  };
}

export function detectRemoteIntegrityAlert(
  remote: RemoteIntegrity,
): DetectedAlert[] {
  if (remote.status !== "fail") {
    return [];
  }
  return [
    {
      kind: "backup-integrity",
      key: "backup-integrity:remote",
      level: "critical",
      title:
        remote.verdict === "missing" ? "원격 사본 없음" : "원격 사본 불일치",
      message: remote.detail,
    },
  ];
}

// ── 데이터베이스 규모 (CTO 결정 1901-④) ──────────────────────

/**
 * 재평가 임계 — 이 규모에 닿으면 백업 성능 기준을 **실측으로 다시 재야 한다**
 * (CTO 결정 1901-④). 지금의 기준(2초/10초/30초)은 100KB 규모에서 정한 값이다.
 */
export const SCALE_MILESTONES_BYTES = [
  10 * 1024 ** 3,
  50 * 1024 ** 3,
  100 * 1024 ** 3,
] as const;

export interface DatabaseScale {
  status: DrStatus;
  detail: string;
  bytes: number | null;
  /** 넘어선 가장 큰 임계 (bytes) — 없으면 null */
  reachedMilestone: number | null;
  /** 다음 임계까지 남은 크기 — 마지막 임계를 넘었으면 null */
  nextMilestone: number | null;
}

function gib(bytes: number): string {
  // 1GB 미만을 "0.0GB"라고 쓰면 비어 있다는 뜻으로 읽힌다 — 실제 크기를 보인다
  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  }
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

/**
 * 데이터베이스 규모 판정.
 *
 * 크기 자체는 문제가 아니다 — **기준을 다시 잴 때가 됐다는 신호**일 뿐이다.
 * 그래서 `warn`이지 `fail`이 아니다.
 */
export function judgeDatabaseScale(bytes: number | null): DatabaseScale {
  if (bytes === null) {
    return {
      status: "manual",
      detail: "데이터베이스 크기를 읽지 못했습니다.",
      bytes: null,
      reachedMilestone: null,
      nextMilestone: SCALE_MILESTONES_BYTES[0],
    };
  }

  const reached = [...SCALE_MILESTONES_BYTES]
    .filter((milestone) => bytes >= milestone)
    .pop();
  const next = SCALE_MILESTONES_BYTES.find((milestone) => bytes < milestone);

  if (reached === undefined) {
    return {
      status: "pass",
      detail:
        `데이터베이스 ${gib(bytes)} — 다음 재평가 기준 ${gib(next!)}까지 ` +
        `${gib(next! - bytes)} 남았습니다.`,
      bytes,
      reachedMilestone: null,
      nextMilestone: next ?? null,
    };
  }

  return {
    status: "warn",
    detail:
      `데이터베이스가 ${gib(bytes)}로 재평가 기준 ${gib(reached)}를 넘었습니다 — ` +
      "백업 성능 기준(2초·10초·30초)을 실측으로 다시 재세요 (CTO 결정 1901-④). " +
      "기준을 자동으로 바꾸지는 않습니다.",
    bytes,
    reachedMilestone: reached,
    nextMilestone: next ?? null,
  };
}

export function detectScaleAlert(scale: DatabaseScale): DetectedAlert[] {
  if (scale.reachedMilestone === null) {
    return [];
  }
  return [
    {
      kind: "backup-integrity",
      // 임계별로 키를 나눈다 — 10GB 경보를 해소하고 50GB에서 다시 알려야 한다
      key: `backup-integrity:scale:${scale.reachedMilestone}`,
      level: "warning",
      title: `백업 기준 재평가 시점 — ${gib(scale.reachedMilestone)}`,
      message: scale.detail,
    },
  ];
}

// ── 저장소 표준 (CTO 결정 1801-④ · 1901-③) ───────────────────

/**
 * 운영 저장소 표준 판정.
 *
 * **Sprint 20부터 운영 저장소 표준은 Amazon S3다.** MinIO·s3rver는 개발
 * 전용이며, 버전 관리·복제 조회를 지원하지 않아 보호 상태를 자동으로 확인할
 * 수 없다.
 *
 * 개발에서는 개발 전용 저장소가 **정상**이다 — 개발자에게 S3를 요구하지 않는다.
 */
export function judgeStorageStandard(
  endpoint: string | null | undefined,
  production: boolean,
): { status: DrStatus; detail: string; standard: boolean } {
  if (!endpoint) {
    return {
      status: production ? "fail" : "manual",
      detail: "저장소 엔드포인트가 설정되지 않았습니다.",
      standard: false,
    };
  }

  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return {
      status: "manual",
      detail: `저장소 엔드포인트를 해석할 수 없습니다: ${endpoint}`,
      standard: false,
    };
  }

  const standard = host.endsWith("amazonaws.com");
  if (standard) {
    return {
      status: "pass",
      detail: `Amazon S3 (${host}) — 운영 표준입니다.`,
      standard: true,
    };
  }

  if (!production) {
    return {
      status: "pass",
      detail: `개발 저장소 (${host}) — 개발에서는 정상입니다. 운영 표준은 Amazon S3입니다.`,
      standard: false,
    };
  }

  return {
    status: "fail",
    detail:
      `운영 저장소가 Amazon S3가 아닙니다 (${host}) — Sprint 20부터 운영 표준은 ` +
      "Amazon S3입니다 (CTO 결정 1901-③). MinIO·s3rver는 개발 전용이며, " +
      "버전 관리·복제 조회를 지원하지 않아 보호 상태를 확인할 수 없습니다.",
    standard: false,
  };
}
