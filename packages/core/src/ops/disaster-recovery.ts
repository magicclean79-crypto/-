/**
 * Backup · Restore Verification · Disaster Recovery. (TASK-1601, Sprint 16)
 *
 * 백업은 **있다는 것만으로는 아무것도 보장하지 않는다** — 복원해 보기 전까지는
 * 백업이 아니라 파일일 뿐이다. 그래서 이 모듈은 백업의 신선도와 **복원 검증
 * 결과**를 함께 판정한다.
 *
 * 판정만 순수하게 두고 실제 `pg_dump`·복원은 api 어댑터가 한다 — 시간과
 * 크기 경계를 시계·디스크 없이 테스트할 수 있어야 하기 때문이다.
 */

export interface BackupRecordInput {
  /** 성공 여부 */
  ok: boolean;
  /** 백업 크기 (bytes) — 실패면 null */
  sizeBytes: number | null;
  createdAt: number;
}

export interface RestoreRecordInput {
  ok: boolean;
  /** 복원 후 확인한 테이블 수 */
  tables: number | null;
  createdAt: number;
}

export type ReadinessVerdict = "ok" | "stale" | "failed" | "missing";

export interface BackupHealth {
  verdict: ReadinessVerdict;
  message: string;
  /** 마지막 성공 백업 이후 경과 (ms) — 없으면 null */
  ageMs: number | null;
  sizeBytes: number | null;
}

/** 기본 백업 신선도 한계 — 하루 1회 백업이므로 2일이면 확실히 이상하다 */
export const DEFAULT_BACKUP_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

/** 백업이 이보다 작으면 빈 덤프를 의심한다 */
export const MIN_BACKUP_BYTES = 1024;

/**
 * 백업 상태 판정.
 *
 * - `missing` — 백업 이력이 없다. **통과가 아니다.**
 * - `failed` — 마지막 시도가 실패했거나 크기가 의심스럽다
 * - `stale` — 성공했지만 너무 오래됐다
 */
export function judgeBackup(
  records: BackupRecordInput[],
  options: { now: number; maxAgeMs?: number },
): BackupHealth {
  if (records.length === 0) {
    return {
      verdict: "missing",
      message: "백업 이력이 없습니다 — 복구할 수 있는 지점이 없습니다.",
      ageMs: null,
      sizeBytes: null,
    };
  }

  const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt);
  const latest = sorted[0];
  const maxAge = options.maxAgeMs ?? DEFAULT_BACKUP_MAX_AGE_MS;

  if (!latest.ok) {
    return {
      verdict: "failed",
      message: "마지막 백업이 실패했습니다 — 로그를 확인하고 즉시 다시 받으세요.",
      ageMs: options.now - latest.createdAt,
      sizeBytes: latest.sizeBytes,
    };
  }

  if (latest.sizeBytes !== null && latest.sizeBytes < MIN_BACKUP_BYTES) {
    // 크기가 0에 가까운 덤프는 "성공"이라도 복원할 수 없다
    return {
      verdict: "failed",
      message:
        `백업 크기가 ${latest.sizeBytes}바이트로 비정상입니다 — 빈 덤프일 수 있습니다.`,
      ageMs: options.now - latest.createdAt,
      sizeBytes: latest.sizeBytes,
    };
  }

  const ageMs = options.now - latest.createdAt;
  if (ageMs > maxAge) {
    return {
      verdict: "stale",
      message:
        `마지막 성공 백업이 ${Math.floor(ageMs / (60 * 60 * 1000))}시간 전입니다 — ` +
        "백업 예약이 도는지 확인하세요.",
      ageMs,
      sizeBytes: latest.sizeBytes,
    };
  }

  return {
    verdict: "ok",
    message: `마지막 백업 ${Math.floor(ageMs / (60 * 1000))}분 전 (${latest.sizeBytes ?? 0}바이트).`,
    ageMs,
    sizeBytes: latest.sizeBytes,
  };
}

export interface RestoreHealth {
  verdict: ReadinessVerdict;
  message: string;
  ageMs: number | null;
  tables: number | null;
}

/** 복원 검증 신선도 — 백업보다 느슨하다(비용이 크므로) */
export const DEFAULT_RESTORE_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * 복원 검증 판정.
 *
 * **복원해 보지 않은 백업은 백업이 아니다** — 이력이 없으면 `missing`이고,
 * 그것은 통과가 아니다.
 */
export function judgeRestore(
  records: RestoreRecordInput[],
  options: { now: number; maxAgeMs?: number },
): RestoreHealth {
  if (records.length === 0) {
    return {
      verdict: "missing",
      message:
        "복원 검증 이력이 없습니다 — 복원해 보지 않은 백업은 백업이 아닙니다.",
      ageMs: null,
      tables: null,
    };
  }

  const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt);
  const latest = sorted[0];
  const maxAge = options.maxAgeMs ?? DEFAULT_RESTORE_MAX_AGE_MS;

  if (!latest.ok) {
    return {
      verdict: "failed",
      message:
        "마지막 복원 검증이 실패했습니다 — 백업 파일이나 복원 절차에 문제가 있습니다.",
      ageMs: options.now - latest.createdAt,
      tables: latest.tables,
    };
  }

  const ageMs = options.now - latest.createdAt;
  if (ageMs > maxAge) {
    return {
      verdict: "stale",
      message: `마지막 복원 검증이 ${Math.floor(ageMs / (24 * 60 * 60 * 1000))}일 전입니다.`,
      ageMs,
      tables: latest.tables,
    };
  }

  return {
    verdict: "ok",
    message: `복원 검증 통과 — 테이블 ${latest.tables ?? 0}개 확인.`,
    ageMs,
    tables: latest.tables,
  };
}

// ── Disaster Recovery Checklist ──────────────────────────────

export type DrStatus = "pass" | "fail" | "warn" | "manual";

export interface DrItem {
  id: string;
  title: string;
  status: DrStatus;
  detail: string;
  /** 복구 가능성을 좌우하는 항목인가 */
  critical: boolean;
}

export interface DrState {
  backup: BackupHealth;
  restore: RestoreHealth;
  /** DB 연결 가능 여부 */
  database: { ok: boolean; detail: string };
  /** 이미지 저장소 접근 여부 */
  storage: { ok: boolean; detail: string };
  /** 분산 잠금(Redis) 사용 가능 여부 — 미사용이면 null */
  lock: { ok: boolean; detail: string } | null;
  /** 알림 채널이 하나라도 살아 있는가 */
  notificationChannels: number;
  /** 복구 절차 문서가 최신인지 사람이 확인해야 한다 */
  runbookPath: string;
  /**
   * Enterprise 항목 (TASK-1701) — 없으면 체크리스트에 넣지 않는다.
   * 순수 판정은 `enterprise-recovery.ts`가 하고, 여기서는 결과만 배치한다.
   */
  enterprise?: {
    /** 덤프 무결성 */
    integrity: { status: DrStatus; detail: string };
    /** 원격 복제 */
    offsite: { status: DrStatus; detail: string };
    /** 이미지 저장소 보호 상태 (CTO 결정 1601-④) */
    storageProtection: { status: DrStatus; detail: string };
    /** 백업 버킷 보호 상태 (CTO 결정 1801-③) */
    backupBucketProtection: { status: DrStatus; detail: string };
    /** 백업 소요 시간 (CTO 결정 1801-①) */
    backupPerformance: { status: DrStatus; detail: string };
    /** 백업 사슬 연속성 (TASK-2001) */
    backupChain: { status: DrStatus; detail: string };
    /** 원격 사본 무결성 (TASK-2001) */
    remoteIntegrity: { status: DrStatus; detail: string };
    /** 운영 저장소 표준 (CTO 결정 1901-③) */
    storageStandard: { status: DrStatus; detail: string };
    /** 복구 목표 RPO·RTO */
    objectives: { status: DrStatus; detail: string };
    /** 복원 대상 분리 (CTO 결정 1601-②) */
    restoreTarget: { status: DrStatus; detail: string };
    /** 복구 리허설 (TASK-1801, CTO 결정 1701-⑤) */
    drill: { status: DrStatus; detail: string };
  };
}

const VERDICT_TO_STATUS: Record<ReadinessVerdict, DrStatus> = {
  ok: "pass",
  stale: "warn",
  failed: "fail",
  missing: "fail",
};

/**
 * 재해 복구 체크리스트 (TASK-1601).
 *
 * 배포 체크리스트(1202)와 목적이 다르다 — 그쪽은 "지금 배포해도 되는가",
 * 이쪽은 **"지금 무너지면 되살릴 수 있는가"** 다.
 *
 * 자동 판정이 불가능한 항목(복구 절차 숙지·연락 체계)은 정직하게 `manual`로
 * 남긴다 — 모르는 것을 통과로 처리하지 않는다.
 */
export function buildDisasterRecoveryChecklist(state: DrState): DrItem[] {
  const items: DrItem[] = [
    {
      id: "backup",
      title: "백업 존재·신선도",
      status: VERDICT_TO_STATUS[state.backup.verdict],
      detail: state.backup.message,
      critical: true,
    },
    {
      id: "restore",
      title: "복원 검증",
      status: VERDICT_TO_STATUS[state.restore.verdict],
      detail: state.restore.message,
      critical: true,
    },
    {
      id: "database",
      title: "데이터베이스 연결",
      status: state.database.ok ? "pass" : "fail",
      detail: state.database.detail,
      critical: true,
    },
    {
      id: "storage",
      title: "이미지 저장소 접근",
      status: state.storage.ok ? "pass" : "fail",
      detail: state.storage.detail,
      critical: true,
    },
  ];

  if (state.enterprise) {
    const {
      integrity,
      offsite,
      storageProtection,
      objectives,
      restoreTarget,
      drill,
      backupBucketProtection,
      backupPerformance,
      backupChain,
      remoteIntegrity,
      storageStandard,
    } = state.enterprise;
    items.push(
      {
        id: "integrity",
        title: "덤프 무결성",
        // 읽히지 않는 덤프는 복원하려는 순간에야 드러난다 — 복구를 좌우한다
        status: integrity.status,
        detail: integrity.detail,
        critical: true,
      },
      {
        id: "restore-target",
        title: "복원 대상 분리",
        status: restoreTarget.status,
        detail: restoreTarget.detail,
        // 운영 DB를 가리키면 검증이 곧 사고다 (CTO 결정 1601-②)
        critical: true,
      },
      {
        id: "offsite",
        title: "백업 원격 복제",
        status: offsite.status,
        detail: offsite.detail,
        // 로컬 덤프로 복구는 되므로 지금의 복구 가능성을 막지는 않는다
        critical: false,
      },
      {
        id: "storage-protection",
        title: "이미지 저장소 보호 (버전 관리·복제)",
        status: storageProtection.status,
        detail: storageProtection.detail,
        critical: false,
      },
      {
        id: "backup-bucket-protection",
        title: "백업 버킷 보호 (버전 관리·복제)",
        status: backupBucketProtection.status,
        detail: backupBucketProtection.detail,
        // 이미지 버킷과 같은 규칙 — 드러내되 지금의 복구를 막지는 않는다
        critical: false,
      },
      {
        id: "backup-performance",
        title: "백업 소요 시간",
        status: backupPerformance.status,
        detail: backupPerformance.detail,
        // 느린 백업은 복구를 막지 않는다 — 추세를 알리는 항목이다
        critical: false,
      },
      {
        id: "backup-chain",
        title: "백업 사슬 연속성",
        status: backupChain.status,
        detail: backupChain.detail,
        // 공백 구간은 **되돌아갈 수 없는 구간**이다 — 복구를 좌우한다
        critical: true,
      },
      {
        id: "remote-integrity",
        title: "원격 사본 무결성",
        status: remoteIntegrity.status,
        detail: remoteIntegrity.detail,
        // 로컬 덤프로 복구는 되므로 지금의 복구 가능성을 막지는 않는다
        critical: false,
      },
      {
        id: "storage-standard",
        title: "운영 저장소 표준",
        status: storageStandard.status,
        detail: storageStandard.detail,
        critical: false,
      },
      {
        id: "objectives",
        title: "복구 목표 (RPO·RTO)",
        status: objectives.status,
        detail: objectives.detail,
        critical: false,
      },
      {
        id: "drill",
        title: "복구 리허설 (분기 1회)",
        status: drill.status,
        detail: drill.detail,
        // 리허설이 밀린 것과 지금 복구가 불가능한 것은 다르다 —
        // 드러내되 복구 가능 판정을 막지는 않는다 (CTO 결정 1701-⑤)
        critical: false,
      },
    );
  }

  if (state.lock !== null) {
    items.push({
      id: "lock",
      title: "분산 잠금(Redis)",
      status: state.lock.ok ? "pass" : "warn",
      detail: state.lock.ok
        ? state.lock.detail
        : `${state.lock.detail} — 예약 점검이 멈추지만 LLM 호출은 계속됩니다 (CTO 결정 1501-②).`,
      critical: false,
    });
  }

  items.push(
    {
      id: "alert-channel",
      title: "경보 전달 채널",
      status: state.notificationChannels > 0 ? "pass" : "warn",
      detail:
        state.notificationChannels > 0
          ? `${state.notificationChannels}개 채널이 설정되어 있습니다.`
          : "채널이 없습니다 — 사고가 나도 로그에만 남습니다.",
      critical: false,
    },
    {
      id: "runbook",
      title: "복구 절차 숙지·연락 체계",
      status: "manual",
      detail: `${state.runbookPath}를 최근에 읽고 절차가 유효한지 확인하세요 (자동 판정 불가).`,
      critical: false,
    },
  );

  return items;
}

export interface DrSummary {
  /** 복구 가능하다고 볼 수 있는가 — critical 실패가 없어야 한다 */
  recoverable: boolean;
  pass: number;
  fail: number;
  warn: number;
  manual: number;
  blockers: DrItem[];
}

export function summarizeDisasterRecovery(items: DrItem[]): DrSummary {
  const blockers = items.filter(
    (item) => item.critical && item.status === "fail",
  );
  return {
    recoverable: blockers.length === 0,
    pass: items.filter((item) => item.status === "pass").length,
    fail: items.filter((item) => item.status === "fail").length,
    warn: items.filter((item) => item.status === "warn").length,
    manual: items.filter((item) => item.status === "manual").length,
    blockers,
  };
}
