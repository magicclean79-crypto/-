/**
 * Migration Governance. (TASK-2301, Sprint 23 — CTO 결정 2201-①)
 *
 * **운영에서 스키마 적용은 운영 담당자가 한다. 애플리케이션은 검증만 한다.**
 *
 * 저장소(2101-④)에 이어 데이터베이스까지 같은 경계를 적용한다. 애플리케이션이
 * 기동 중에 스키마를 바꾸면 두 가지가 무너진다: 여러 인스턴스가 동시에 뜰 때
 * 누가 적용하는지 알 수 없고, **배포를 되돌릴 때 스키마는 되돌아가지 않는다.**
 *
 * 검증만 한다는 것은 **검증이 실제로 작동해야 한다**는 뜻이다. 그래서 이 모듈은
 * `_prisma_migrations`의 실패 행만 세지 않고, **마이그레이션 디렉터리와 적용
 * 기록을 대조한다** — 적용하지 않은 마이그레이션은 실패 행조차 남기지 않으므로,
 * 실패 행만 세면 "미적용 없음"이라는 거짓 통과가 나온다.
 */

import type { ChecklistStatus } from "./deployment-checklist";
import type { DetectedAlert } from "./alerts";

export interface MigrationState {
  /** `prisma/migrations` 디렉터리 이름 — 읽지 못했으면 null */
  directories: string[] | null;
  /** `_prisma_migrations`에 완료로 남은 이름 — 읽지 못했으면 null */
  applied: string[] | null;
  /** 적용 중 실패했거나 롤백된 건수 — 읽지 못했으면 null */
  failed: number | null;
}

export interface MigrationGovernance {
  status: ChecklistStatus;
  detail: string;
  /** 코드에는 있는데 적용되지 않은 마이그레이션 */
  pending: string[];
  /** 적용됐는데 코드에 없는 마이그레이션 (되돌린 배포·브랜치 불일치 신호) */
  unknown: string[];
  /** 적용 주체 — 운영은 항상 `operator` */
  appliedBy: "operator" | "developer";
}

/**
 * 스키마 적용 상태 판정.
 *
 * **모르는 것을 통과로 세지 않는다** — 디렉터리나 적용 기록 중 하나라도 읽지
 * 못하면 `manual`이다.
 */
export function judgeMigrations(
  state: MigrationState,
  options: { production: boolean },
): MigrationGovernance {
  const appliedBy = options.production ? "operator" : "developer";
  // 한 문장에 줄표를 두 번 쓰지 않는다 — 호출부가 이미 줄표로 잇는다
  const howToApply = options.production
    ? "운영 담당자가 `pnpm prisma:migrate deploy`를 실행해야 합니다. 애플리케이션은 스키마를 적용하지 않습니다 (CTO 결정 2201-①)."
    : "`pnpm prisma:migrate deploy`로 적용하세요.";

  if (state.failed === null || state.directories === null || state.applied === null) {
    return {
      status: "manual",
      // 실패 행만 세는 것으로는 미적용을 알 수 없다 — 그 한계를 문구에 적는다
      detail:
        "스키마 적용 상태를 확인하지 못했습니다 — 마이그레이션 목록과 적용 기록을 " +
        "모두 읽어야 판정할 수 있습니다. 직접 확인하세요.",
      pending: [],
      unknown: [],
      appliedBy,
    };
  }

  // 대조는 **먼저** 한다. 실패 행이 있다는 이유로 미적용 목록을 비워 두면
  // `pendingMigrations`가 0으로 보고되고, 그것은 "미적용 없음"이라는 거짓
  // 통과다 (CTO 결정 2301-④). 무엇을 먼저 알릴지와 무엇이 사실인지는 다르다.
  const appliedSet = new Set(state.applied);
  const directorySet = new Set(state.directories);
  const pending = state.directories
    .filter((name) => !appliedSet.has(name))
    .sort();
  const unknown = state.applied.filter((name) => !directorySet.has(name)).sort();

  if (state.failed > 0) {
    return {
      status: "fail",
      detail:
        `적용 중 실패하거나 롤백된 마이그레이션 ${state.failed}건이 있습니다 — ` +
        "스키마가 중간 상태일 수 있습니다. 배포하지 말고 먼저 정리하세요.",
      pending,
      unknown,
      appliedBy,
    };
  }

  if (pending.length > 0) {
    return {
      status: "fail",
      detail:
        `미적용 마이그레이션 ${pending.length}건: ${pending.join(", ")} — ${howToApply}`,
      pending,
      unknown,
      appliedBy,
    };
  }

  if (unknown.length > 0) {
    // 실패는 아니다 — 코드가 뒤로 간 것일 수 있고, 그 자체가 사고는 아니다.
    // 다만 조용히 지나가면 "왜 이 컬럼이 있지"를 나중에 아무도 설명할 수 없다.
    return {
      status: "warn",
      detail:
        `적용됐는데 코드에 없는 마이그레이션 ${unknown.length}건: ${unknown.join(", ")} — ` +
        "되돌린 배포이거나 다른 브랜치가 적용한 것입니다. 스키마가 코드보다 앞서 있습니다.",
      pending: [],
      unknown,
      appliedBy,
    };
  }

  return {
    status: "pass",
    detail: `마이그레이션 ${state.applied.length}건 모두 적용됨.`,
    pending: [],
    unknown: [],
    appliedBy,
  };
}

// ── 코드에 없는 마이그레이션의 경보 승격 (CTO 결정 2301-②) ──────────

/**
 * 스키마가 코드보다 앞선 상태를 **얼마나 두고 볼 것인가** — 7일
 * (CTO 결정 2301-②).
 *
 * 되돌린 배포는 흔하고, 되돌린 직후에 사람을 부를 일은 아니다. 다만 일주일이
 * 지나도 그대로라면 **되돌린 것이 아니라 잊은 것이다.**
 */
export const UNKNOWN_MIGRATION_ESCALATE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 코드에 없는 마이그레이션 경보 (CTO 결정 2301-②).
 *
 * - 최초: `warning`
 * - 처음 관측한 뒤 **7일 초과**: `critical`
 * - **배포는 막지 않는다** — 스키마가 앞서 있다고 지금 서비스가 잘못 도는
 *   것은 아니다. 막으면 되돌린 배포를 다시 되돌릴 수 없게 된다.
 *
 * `firstSeenAt`은 경보 저장소가 이미 갖고 있다(`firstRaisedAt`) — 관측 기록을
 * 위해 새 테이블을 두지 않는다. 경보는 삭제하지 않으므로(결정 1302-④) 그
 * 시각이 곧 "처음 본 때"다.
 */
export function detectUnknownMigrationAlert(
  unknown: string[],
  options: { now: number; firstSeenAt: number | null; escalateAfterMs?: number },
): DetectedAlert[] {
  if (unknown.length === 0) {
    return [];
  }
  const escalateAfterMs =
    options.escalateAfterMs ?? UNKNOWN_MIGRATION_ESCALATE_MS;
  // 처음 보는 순간에는 경과가 0이다 — 그때를 기준으로 센다
  const ageMs = options.firstSeenAt === null ? 0 : options.now - options.firstSeenAt;
  const escalated = ageMs > escalateAfterMs;
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));

  return [
    {
      kind: "migration-governance",
      // 목록이 바뀌어도 같은 문제로 본다 — 키가 바뀌면 경과가 초기화된다
      key: "migration-governance:unknown",
      level: escalated ? "critical" : "warning",
      title: escalated
        ? "스키마가 코드보다 앞선 상태가 7일을 넘었습니다"
        : "적용됐는데 코드에 없는 마이그레이션",
      message: escalated
        ? `${unknown.join(", ")} — ${days}일째 스키마가 코드보다 앞서 있습니다. ` +
          "되돌린 배포라면 마이그레이션을 코드로 되살리거나 스키마를 정리하세요. " +
          "배포는 막지 않습니다 (CTO 결정 2301-②)."
        : `${unknown.join(", ")} — 되돌린 배포이거나 다른 브랜치가 적용한 것입니다. ` +
          `${Math.floor(escalateAfterMs / (24 * 60 * 60 * 1000))}일이 지나도 그대로면 심각으로 올립니다.`,
    },
  ];
}
