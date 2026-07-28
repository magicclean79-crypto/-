import type { EnvValidationResult } from "./env-spec";

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
  /** 미적용 마이그레이션 수 (알 수 없으면 null) */
  pendingMigrations: number | null;
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
    title: "마이그레이션 적용",
    blocking: true,
    status:
      state.pendingMigrations === null
        ? "manual"
        : state.pendingMigrations === 0
          ? "pass"
          : "fail",
    detail:
      state.pendingMigrations === null
        ? "적용 상태를 확인할 수 없습니다 — `pnpm prisma:migrate deploy` 실행 여부를 직접 확인하세요."
        : state.pendingMigrations === 0
          ? "미적용 마이그레이션 없음."
          : `미적용 마이그레이션 ${state.pendingMigrations}건 — 배포 전에 적용하세요.`,
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
