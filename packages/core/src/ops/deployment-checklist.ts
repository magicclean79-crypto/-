import type { EnvValidationResult } from "./env-spec";
import type { MigrationGovernance } from "./migration-governance";
import type { ProtectionState } from "./enterprise-recovery";

/**
 * Deployment Checklist. (TASK-1202, Sprint 12)
 *
 * 배포 전에 확인할 항목을 **기계가 판정할 수 있는 형태**로 둔다.
 * 문서로만 있는 체크리스트는 지켜졌는지 확인할 방법이 없고, 결국
 * "확인했다고 치는" 절차가 된다. 여기서는 실제 상태를 입력으로 받아
 * 통과/실패/확인필요를 판정하고, 사람이 직접 봐야 하는 항목만 `manual`로 남긴다.
 */

export type ChecklistStatus = "pass" | "fail" | "warn" | "manual";

export interface ChecklistItem {
  id: string;
  title: string;
  status: ChecklistStatus;
  /** 판정 근거 또는 해야 할 일 */
  detail: string;
  /** 실패 시 배포를 막아야 하는 항목인가 */
  blocking: boolean;
}

export interface DeploymentState {
  environment: EnvValidationResult;
  /** DB 연결 가능 여부 */
  database: { ok: boolean; detail: string };
  /**
   * 스키마 적용 상태 (TASK-2301, CTO 결정 2201-①).
   *
   * 실패 행만 세는 것으로는 **미적용을 알 수 없다** — 적용하지 않은
   * 마이그레이션은 실패 행조차 남기지 않는다. 그래서 목록 대조 결과를 받는다.
   */
  migrations: MigrationGovernance;
  /** 이미지 저장소 접근 가능 여부 */
  storage: { ok: boolean; detail: string };
  /** 실제 호출 가능한 Provider 목록 */
  availableProviders: string[];
  /** 기본 Provider */
  defaultProvider: string;
  /** 예산이 설정되어 있는가 */
  budgetConfigured: boolean;
  /** Failover 우선순위가 설정되어 있는가 */
  failoverConfigured: boolean;
  /** 관리자 계정이 존재하는가 */
  adminUserExists: boolean;
  /** 운영 환경인가 */
  production: boolean;
  /**
   * 운영 표준 배포 체크리스트 항목 (TASK-2301, CTO 결정 2201-④).
   *
   * 운영에서 애플리케이션은 이것들을 **만들지 않고 검증만 한다** —
   * 그래서 배포 전에 사람이 준비했는지 확인하는 것이 절차의 일부가 된다.
   */
  operations: {
    /** 버킷·IAM 준비 주체 — 운영은 `external` */
    provisioningMode: "managed" | "external";
    /** 이미지 버킷 이름·존재 */
    bucket: { name: string; exists: boolean | null };
    /** 백업 버킷 이름·존재·이미지 버킷과 분리 여부 */
    backupBucket: { name: string; exists: boolean | null; separated: boolean };
    /** 이미지 버킷 보호 상태 */
    versioning: ProtectionState;
    /** 백업 버킷 보호 상태 */
    backupVersioning: ProtectionState;
    /** 재해 복구 판정 — 복구 가능한가 (알 수 없으면 null) */
    recoverable: boolean | null;
  };
}

/**
 * 배포 준비 상태 판정.
 * `blocking` 실패가 하나라도 있으면 배포하면 안 된다.
 */
export function buildDeploymentChecklist(
  state: DeploymentState,
): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  items.push({
    id: "env",
    title: "환경변수 검증",
    blocking: true,
    status: state.environment.ok
      ? state.environment.warnings.length > 0
        ? "warn"
        : "pass"
      : "fail",
    detail: state.environment.ok
      ? state.environment.warnings.length > 0
        ? `필수 항목은 충족했으나 권고 ${state.environment.warnings.length}건이 있습니다.`
        : `${state.environment.checked}개 항목 이상 없음.`
      : `필수/형식 오류 ${state.environment.errors.length}건 — ${state.environment.errors
          .map((issue) => issue.name)
          .join(", ")}`,
  });

  items.push({
    id: "database",
    title: "데이터베이스 연결",
    blocking: true,
    status: state.database.ok ? "pass" : "fail",
    detail: state.database.detail,
  });

  items.push({
    id: "migrations",
    title:
      state.migrations.appliedBy === "operator"
        ? "마이그레이션 적용 (운영 담당자 수행)"
        : "마이그레이션 적용",
    blocking: true,
    status: state.migrations.status,
    detail: state.migrations.detail,
  });

  items.push({
    id: "storage",
    title: "이미지 저장소 접근",
    blocking: true,
    status: state.storage.ok ? "pass" : "fail",
    detail: state.storage.detail,
  });

  items.push({
    id: "admin-user",
    title: "관리자 계정",
    blocking: true,
    status: state.adminUserExists ? "pass" : "fail",
    detail: state.adminUserExists
      ? "ADMIN 계정이 존재합니다."
      : "ADMIN 계정이 없습니다 — AUTH_ADMIN_EMAIL/PASSWORD로 부트스트랩하세요.",
  });

  const realProviders = state.availableProviders.filter(
    (provider) => provider !== "mock",
  );
  items.push({
    id: "provider",
    title: "실제 Provider 연결",
    blocking: state.production,
    status: realProviders.length > 0 ? "pass" : state.production ? "fail" : "warn",
    detail:
      realProviders.length > 0
        ? `사용 가능: ${realProviders.join(", ")} (기본 ${state.defaultProvider})`
        : "mock만 사용 가능합니다 — 운영에서는 실제 Provider 키가 필요합니다.",
  });

  // 미설정은 운영에서만 경고다. 개발에서 통과로 두더라도 **설명이 상태와
  // 어긋나지 않게** 한다 — "통과"인데 경고 문구가 붙으면 읽는 사람이 혼란스럽다.
  items.push({
    id: "budget",
    title: "비용 예산 설정",
    blocking: false,
    status: state.budgetConfigured ? "pass" : state.production ? "warn" : "pass",
    detail: state.budgetConfigured
      ? "일/월 예산이 설정되어 있습니다."
      : state.production
        ? "예산이 없습니다 — 비용 폭주를 막을 상한이 없습니다."
        : "예산 미설정 (개발 환경에서는 무방 — 운영 전에 설정하세요).",
  });

  items.push({
    id: "failover",
    title: "Failover 우선순위",
    blocking: false,
    status: state.failoverConfigured
      ? "pass"
      : state.production
        ? "warn"
        : "pass",
    detail: state.failoverConfigured
      ? "우선순위가 설정되어 있습니다."
      : state.production
        ? "Failover가 비활성입니다 — 단일 Provider 장애가 곧 서비스 중단입니다."
        : "Failover 미설정 (개발 환경에서는 무방 — 운영 전에 설정하세요).",
  });


  // ── 운영 표준 배포 체크리스트 (TASK-2301, CTO 결정 2201-④) ──────────
  //
  // 운영에서 애플리케이션은 버킷·IAM·스키마를 **만들지 않고 검증만 한다**
  // (결정 2201-①). 그러면 "누가 준비했는지"를 배포 전에 확인하는 일이
  // 절차의 일부가 되어야 한다 — 확인하지 않으면 준비되지 않은 채로 뜬다.
  const ops = state.operations;
  const external = ops.provisioningMode === "external";

  items.push({
    id: "bucket",
    title: "이미지 버킷 준비",
    // 운영에서는 앱이 만들지 않으므로, 없으면 배포해도 업로드가 죽는다
    blocking: state.production,
    status:
      ops.bucket.exists === null
        ? "manual"
        : ops.bucket.exists
          ? "pass"
          : state.production
            ? "fail"
            : "warn",
    detail:
      ops.bucket.exists === null
        ? `버킷 존재를 확인하지 못했습니다 (${ops.bucket.name}) — 저장소에 접근할 수 없습니다.`
        : ops.bucket.exists
          ? `${ops.bucket.name} 확인됨.`
          : external
            ? `${ops.bucket.name}이(가) 없습니다 — 운영 담당자가 버킷을 만들어야 합니다. 애플리케이션은 만들지 않습니다 (CTO 결정 2101-④).`
            : `${ops.bucket.name}이(가) 없습니다 — 개발에서는 기동 시 자동으로 만듭니다.`,
  });

  items.push({
    id: "iam",
    title: "저장소 접근 권한 (IAM)",
    blocking: false,
    // 보호 상태를 읽을 수 없다는 것은 대개 **조회 권한이 없다**는 뜻이다
    status:
      ops.versioning === "unknown" || ops.backupVersioning === "unknown"
        ? state.production
          ? "warn"
          : "pass"
        : "pass",
    detail:
      ops.versioning === "unknown" || ops.backupVersioning === "unknown"
        ? state.production
          ? "버킷 보호 상태를 읽지 못했습니다 — s3:GetBucketVersioning · s3:GetReplicationConfiguration 권한을 확인하세요. 저장소가 S3인 것과 상태를 읽을 수 있는 것은 다릅니다."
          : "개발 저장소는 보호 상태 조회를 지원하지 않습니다 — 개발에서는 정상입니다."
        : "보호 상태를 읽을 수 있습니다 — 조회 권한이 부여되어 있습니다.",
  });

  items.push({
    id: "versioning",
    title: "이미지 버킷 버전 관리",
    // 운영 필수 (CTO 결정 1701-③)
    blocking: state.production && ops.versioning === "disabled",
    status:
      ops.versioning === "enabled"
        ? "pass"
        : ops.versioning === "unknown"
          ? "manual"
          : state.production
            ? "fail"
            : "warn",
    detail:
      ops.versioning === "enabled"
        ? "버전 관리가 켜져 있습니다."
        : ops.versioning === "unknown"
          ? "버전 관리 상태를 알 수 없습니다 — 제공자 콘솔에서 직접 확인하세요."
          : "버전 관리가 꺼져 있습니다 — 실수로 덮어쓴 이미지를 되돌릴 수 없습니다 (운영 필수, CTO 결정 1701-③).",
  });

  items.push({
    id: "backup-bucket",
    title: "백업 버킷 준비·분리",
    blocking: state.production,
    status:
      ops.backupBucket.exists === null
        ? "manual"
        : !ops.backupBucket.exists
          ? state.production
            ? "fail"
            : "warn"
          : !ops.backupBucket.separated
            ? state.production
              ? "fail"
              : "warn"
            : ops.backupVersioning === "enabled"
              ? "pass"
              : ops.backupVersioning === "unknown"
                ? "manual"
                : "warn",
    detail:
      ops.backupBucket.exists === null
        ? `백업 버킷 존재를 확인하지 못했습니다 (${ops.backupBucket.name}).`
        : !ops.backupBucket.exists
          ? `${ops.backupBucket.name}이(가) 없습니다 — ${external ? "운영 담당자가 만들어야 합니다" : "기동 시 자동으로 만듭니다"}.`
          : !ops.backupBucket.separated
            ? "백업 버킷이 이미지 버킷과 같습니다 — 그 버킷이 사라지면 이미지와 백업이 함께 사라집니다 (CTO 결정 1701-②)."
            : ops.backupVersioning === "enabled"
              ? `${ops.backupBucket.name} 분리됨 · 버전 관리 켜짐.`
              : ops.backupVersioning === "unknown"
                ? `${ops.backupBucket.name} 분리됨 — 버전 관리 상태는 직접 확인하세요.`
                : `${ops.backupBucket.name} 분리됨 — 버전 관리가 꺼져 있습니다.`,
  });

  items.push({
    id: "readiness",
    title: "재해 복구 판정 (복구 가능 여부)",
    // 지금 무너지면 되살릴 수 없는 상태로 배포하지 않는다.
    // 복구 리허설은 여기에 들어오지 않는다 — 배포 게이트가 아니다 (결정 1801-②).
    blocking: state.production,
    status:
      ops.recoverable === null
        ? "manual"
        : ops.recoverable
          ? "pass"
          : state.production
            ? "fail"
            : "warn",
    detail:
      ops.recoverable === null
        ? "재해 복구 판정을 확인하지 못했습니다 — /ops/readiness를 직접 확인하세요."
        : ops.recoverable
          ? "복구 가능 — 복구 필수 항목에 실패가 없습니다."
          : "복구 불가 — 지금 무너지면 되살릴 수 없습니다. /ops/readiness에서 실패 항목을 먼저 해결하세요.",
  });

  // 자동 판정이 불가능한 항목은 정직하게 manual로 남긴다
  items.push({
    id: "smoke",
    title: "실 Provider 스모크 (배포 직후 1회)",
    blocking: false,
    status: "manual",
    detail:
      "`node scripts/real-provider-smoke.mjs` 실행 — 운영/스테이징 배포 직후 필수 (0901 승인 ③).",
  });
  items.push({
    id: "backup",
    title: "DB 백업·복구 확인",
    blocking: false,
    status: "manual",
    detail:
      "최근 백업 존재와 복구 절차를 확인하세요 — docs/operations/recovery-guide.md.",
  });

  return items;
}

export interface ReadinessSummary {
  /** 배포해도 되는가 (blocking 실패 없음) */
  ready: boolean;
  pass: number;
  fail: number;
  warn: number;
  manual: number;
  /** 배포를 막는 항목 */
  blockers: ChecklistItem[];
}

export function summarizeChecklist(items: ChecklistItem[]): ReadinessSummary {
  const blockers = items.filter(
    (item) => item.blocking && item.status === "fail",
  );
  return {
    ready: blockers.length === 0,
    pass: items.filter((item) => item.status === "pass").length,
    fail: items.filter((item) => item.status === "fail").length,
    warn: items.filter((item) => item.status === "warn").length,
    manual: items.filter((item) => item.status === "manual").length,
    blockers,
  };
}
