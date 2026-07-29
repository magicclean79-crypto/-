/**
 * Enterprise Backup & Disaster Recovery. (TASK-1701, Sprint 17)
 *
 * TASK-1601은 "백업이 있고 복원된다"를 증명했다. 이번 모듈이 다루는 것은 그
 * 다음 질문들이다:
 *
 * - 백업이 **원본과 같은 곳에만** 있으면, 그 곳이 사라질 때 백업도 사라진다.
 * - 복원되는 것과 **덤프가 온전한 것**은 다르다 — 읽히지 않는 덤프는 복원
 *   시점에야 드러난다.
 * - "복구할 수 있다"만으로는 부족하다 — **얼마를 잃고**(RPO) **얼마나
 *   걸리는지**(RTO)가 계약이다.
 *
 * 판정만 순수하게 두고, 업로드·체크섬·버킷 조회는 api 어댑터가 한다.
 */

import type { DrStatus } from "./disaster-recovery";

// ── 원격 복제 (Offsite) ──────────────────────────────────────

export interface OffsiteInput {
  /** 원격 복제를 쓰는 구성인가 */
  configured: boolean;
  /** 마지막 성공 백업이 원격에도 올라갔는가 — 백업 자체가 없으면 null */
  latestReplicated: boolean | null;
  /** 원격에 있는 백업 개수 */
  copies: number;
}

export interface OffsiteHealth {
  status: DrStatus;
  detail: string;
}

/**
 * 원격 복제 판정.
 *
 * **미구성은 실패가 아니다** — 다만 "호스트가 사라지면 백업도 사라진다"는
 * 사실을 숨기지 않는다. 복구 자체는 로컬 덤프로 가능하므로 복구 가능성을
 * 좌우하는 항목으로는 두지 않는다.
 */
export function judgeOffsite(input: OffsiteInput): OffsiteHealth {
  if (!input.configured) {
    return {
      status: "warn",
      detail:
        "원격 복제가 꺼져 있습니다 — 백업이 데이터베이스와 같은 곳에만 있어, " +
        "그 곳이 사라지면 백업도 함께 사라집니다.",
    };
  }
  if (input.latestReplicated === null) {
    return {
      status: "warn",
      detail: "복제할 백업이 아직 없습니다.",
    };
  }
  if (!input.latestReplicated) {
    return {
      status: "fail",
      detail:
        "마지막 백업이 원격에 올라가지 못했습니다 — 저장소 자격 증명과 용량을 확인하세요.",
    };
  }
  return {
    status: "pass",
    detail: `원격 사본 ${input.copies}개 — 마지막 백업이 원격에도 있습니다.`,
  };
}

// ── 덤프 무결성 ──────────────────────────────────────────────

export interface IntegrityInput {
  /** 덤프 목록 읽기(pg_restore --list)가 성공했는가 — 확인하지 못했으면 null */
  readable: boolean | null;
  /** 기록된 체크섬 (SHA-256) */
  checksum: string | null;
  /** 덤프 안에서 확인한 객체 수 */
  entries: number | null;
}

/**
 * 무결성 판정.
 *
 * **확인하지 못한 것은 통과가 아니다** — `readable`이 null이면 `manual`이다.
 * 읽히지 않는 덤프는 복원하려는 순간에야 드러나고, 그때는 이미 늦다.
 */
export function judgeIntegrity(input: IntegrityInput): {
  status: DrStatus;
  detail: string;
} {
  if (input.readable === null) {
    return {
      status: "manual",
      detail:
        "덤프 무결성을 확인하지 못했습니다 — 백업 이력이 없거나 점검이 돌지 않았습니다.",
    };
  }
  if (!input.readable) {
    return {
      status: "fail",
      detail:
        "마지막 덤프를 읽을 수 없습니다 — 파일이 손상되었을 수 있습니다. 즉시 다시 받으세요.",
    };
  }
  const checksum = input.checksum
    ? ` · SHA-256 ${input.checksum.slice(0, 12)}…`
    : "";
  return {
    status: "pass",
    detail: `덤프 목록 판독 정상 — 객체 ${input.entries ?? 0}개${checksum}.`,
  };
}

// ── 저장소 보호 상태 (CTO 결정 1601-④) ───────────────────────

export type ProtectionState = "enabled" | "disabled" | "unknown";

export interface StorageProtectionInput {
  versioning: ProtectionState;
  replication: ProtectionState;
  /** 운영 환경인가 — 운영에서는 Versioning이 필수다 (CTO 결정 1701-③) */
  production?: boolean;
  /**
   * 무엇을 담는 버킷인가 — 문구에 쓴다 (CTO 결정 1801-③).
   * 이미지와 백업 버킷을 같은 규칙으로 판정하되, **어느 쪽 이야기인지는
   * 분명해야** 한다. "버전 관리가 꺼져 있습니다"만 두 번 나오면 어느 버킷을
   * 고쳐야 할지 알 수 없다.
   */
  label?: string;
}

/**
 * 이미지 저장소 보호 상태 판정 (CTO 결정 1601-④).
 *
 * **애플리케이션은 이미지를 직접 백업하지 않는다** — 저장소 제공자의 버전
 * 관리·복제에 의존한다. 그러니 최소한 **그 정책이 켜져 있는지는 보여야 한다.**
 *
 * 저장소가 알려 주지 않으면(`unknown`) `manual`이다 — 로컬 목업처럼 조회를
 * 지원하지 않는 저장소를 "정상"이라고 말하면 그 화면은 거짓이 된다.
 *
 * **Versioning은 운영 필수, Replication은 운영 권장**이다 (CTO 결정 1701-③).
 * 둘의 무게가 다른 이유: 버전 관리가 없으면 **실수 한 번으로 되돌릴 수 없게**
 * 되지만, 복제가 없는 것은 리전 전체가 사라지는 훨씬 드문 사건에 대한
 * 대비가 없다는 뜻이다. 개발 환경에서는 둘 다 권장에 머문다.
 */
export function judgeStorageProtection(input: StorageProtectionInput): {
  status: DrStatus;
  detail: string;
} {
  const what = input.label ?? "이미지 저장소";

  if (input.versioning === "unknown" || input.replication === "unknown") {
    return {
      status: "manual",
      // 조사를 붙이면 이름에 따라 "버킷가"처럼 어긋난다 — 문장을 나눈다
      detail:
        `${what} — 버전 관리·복제 상태를 알려 주지 않습니다. 제공자 콘솔에서 ` +
        "직접 확인하세요. 운영 저장소 표준은 Amazon S3이며, MinIO·s3rver는 " +
        "개발 전용이라 조회를 지원하지 않습니다 (CTO 결정 1801-④).",
    };
  }
  if (input.versioning === "enabled" && input.replication === "enabled") {
    return {
      status: "pass",
      detail: `${what}: 버전 관리·복제가 모두 켜져 있습니다.`,
    };
  }

  // 운영에서 버전 관리가 꺼진 것은 권고 위반이 아니라 요건 미충족이다
  if (input.production && input.versioning === "disabled") {
    return {
      status: "fail",
      detail:
        `${what}의 버전 관리가 꺼져 있습니다 — 운영 필수입니다 ` +
        "(CTO 결정 1701-③). 지우거나 덮어쓰면 되돌릴 수 없습니다.",
    };
  }

  const off = [
    input.versioning === "disabled" ? "버전 관리" : null,
    input.replication === "disabled" ? "복제" : null,
  ]
    .filter(Boolean)
    .join("·");
  return {
    status: "warn",
    detail:
      `${what}의 ${off}가 꺼져 있습니다 — 지우거나 덮어쓰면 되돌릴 수 없습니다.`,
  };
}

// ── 복구 목표 (RPO · RTO) ────────────────────────────────────

/**
 * 기본 RPO — 백업이 1시간 간격이므로 그 2배를 상한으로 본다
 * (CTO 결정 1701-①). 실제 목표는 `defaultRpoTargetMs(간격)`으로 계산한다.
 */
export const DEFAULT_RPO_MS = 2 * 60 * 60 * 1000;

/** 기본 RTO — 복원 자체는 30분 안에 끝나야 한다는 목표 */
export const DEFAULT_RTO_MS = 30 * 60 * 1000;

export interface RecoveryObjectiveInput {
  /** 마지막 성공 백업 이후 경과 (ms) — 백업이 없으면 null */
  lastBackupAgeMs: number | null;
  /** 마지막 성공 복원 검증에 걸린 시간 (ms) — 측정치가 없으면 null */
  measuredRestoreMs: number | null;
  rpoTargetMs?: number;
  rtoTargetMs?: number;
}

export interface RecoveryObjectives {
  /** 지금 무너지면 잃을 최대 구간 (ms) */
  rpoMs: number | null;
  rpoTargetMs: number;
  /** 목표를 지키고 있는가 — 확인 불가면 null */
  rpoMet: boolean | null;
  /** 복원에 걸리는 시간 (측정치, ms) */
  rtoMs: number | null;
  rtoTargetMs: number;
  rtoMet: boolean | null;
  status: DrStatus;
  detail: string;
}

/**
 * 복구 목표 판정 (RPO · RTO).
 *
 * **RTO는 실제 복원 검증에 걸린 시간**을 쓴다 — 추정이 아니라 측정이다.
 * 다만 이는 **하한**이다: 사람이 장애를 알아차리고 결정하는 시간, 인프라를
 * 준비하는 시간은 포함하지 않는다. 그렇게 적어 둔다.
 *
 * 측정치가 없으면 `null`이고 그것은 **통과가 아니다**.
 */
export function judgeRecoveryObjectives(
  input: RecoveryObjectiveInput,
): RecoveryObjectives {
  const rpoTargetMs = input.rpoTargetMs ?? DEFAULT_RPO_MS;
  const rtoTargetMs = input.rtoTargetMs ?? DEFAULT_RTO_MS;

  const rpoMs = input.lastBackupAgeMs;
  const rtoMs = input.measuredRestoreMs;
  const rpoMet = rpoMs === null ? null : rpoMs <= rpoTargetMs;
  const rtoMet = rtoMs === null ? null : rtoMs <= rtoTargetMs;

  if (rpoMs === null || rtoMs === null) {
    return {
      rpoMs,
      rpoTargetMs,
      rpoMet,
      rtoMs,
      rtoTargetMs,
      rtoMet,
      status: "manual",
      detail:
        rpoMs === null
          ? "백업이 없어 손실 구간(RPO)을 계산할 수 없습니다."
          : "복원 검증 측정치가 없어 복구 소요(RTO)를 알 수 없습니다 — 한 번 복원해 보세요.",
    };
  }

  const detail =
    `지금 무너지면 최대 ${formatDuration(rpoMs)}치를 잃습니다 ` +
    `(목표 ${formatDuration(rpoTargetMs)}) · 복원에 ${formatDuration(rtoMs)} ` +
    `걸렸습니다 (목표 ${formatDuration(rtoTargetMs)}). ` +
    "복원 시간은 측정된 하한이며, 장애를 알아차리고 결정하는 시간은 포함하지 않습니다.";

  return {
    rpoMs,
    rpoTargetMs,
    rpoMet,
    rtoMs,
    rtoTargetMs,
    rtoMet,
    status: rpoMet && rtoMet ? "pass" : "warn",
    detail,
  };
}

function formatDuration(ms: number): string {
  if (ms >= 24 * 60 * 60 * 1000) {
    return `${(ms / (24 * 60 * 60 * 1000)).toFixed(1)}일`;
  }
  if (ms >= 60 * 60 * 1000) {
    return `${(ms / (60 * 60 * 1000)).toFixed(1)}시간`;
  }
  if (ms >= 60 * 1000) {
    return `${Math.round(ms / (60 * 1000))}분`;
  }
  return `${Math.round(ms / 1000)}초`;
}

// ── 복원 대상 안전장치 (CTO 결정 1601-②) ─────────────────────

export type RestoreTargetVerdict = "ok" | "same-as-production" | "not-configured";

/**
 * 복원 대상이 안전한지 판정 (CTO 결정 1601-②).
 *
 * **복원은 운영 DB가 아닌 별도 Restore DB에서만 수행한다.** 복원은 대상 스키마를
 * 지우고 쓰므로, 운영 DB를 가리키면 **검증이 곧 사고**가 된다.
 *
 * 사용자·비밀번호·쿼리 파라미터는 무시하고 **호스트·포트·데이터베이스 이름**만
 * 비교한다 — 같은 DB를 다른 자격 증명으로 가리켜도 같은 DB다.
 */
export function judgeRestoreTarget(
  productionUrl: string | null | undefined,
  restoreUrl: string | null | undefined,
): { verdict: RestoreTargetVerdict; detail: string } {
  const restore = (restoreUrl ?? "").trim();
  if (!restore) {
    return {
      verdict: "not-configured",
      detail:
        "복원 검증 대상 DB가 없습니다 — 복원해 보지 않은 백업은 백업이 아닙니다.",
    };
  }

  const target = identifyDatabase(restore);
  const production = identifyDatabase((productionUrl ?? "").trim());
  if (target !== null && production !== null && target === production) {
    return {
      verdict: "same-as-production",
      detail:
        "복원 대상이 운영 데이터베이스와 같습니다 — 복원은 대상을 지우고 쓰므로 " +
        "검증이 곧 사고가 됩니다. 별도 데이터베이스를 지정하세요 (CTO 결정 1601-②).",
    };
  }

  return { verdict: "ok", detail: "복원 대상이 운영 데이터베이스와 분리되어 있습니다." };
}

/** 호스트·포트·DB 이름만 뽑는다 — 자격 증명이 달라도 같은 DB는 같은 DB다 */
function identifyDatabase(url: string): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    const port = parsed.port || "5432";
    const name = parsed.pathname.replace(/^\//, "").toLowerCase();
    if (!name) {
      return null;
    }
    return `${parsed.hostname.toLowerCase()}:${port}/${name}`;
  } catch {
    return null;
  }
}
