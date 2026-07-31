/**
 * 배포 단계별 진단·경보 정책. (TASK-4101, Sprint 41 — CTO 정책 4101-③)
 *
 * TASK-4001의 진단은 세상을 둘로 봤습니다: **운영이거나 아니거나.** 그리고
 * 경보는 운영에서만 냈습니다. 그 판단은 개발자 노트북에 대해서는 옳았지만,
 * **스테이징을 개발과 같은 칸에 넣는 결과**를 낳았습니다.
 *
 * ## 스테이징을 개발처럼 다루면 스테이징이 아닙니다
 *
 * 스테이징의 빨간불이 아무 데도 안 가면, 스테이징은 검증 환경이 아니라
 * **그냥 또 하나의 개발 환경**입니다. 그런데 우리가 실 Provider 검증을
 * 하려는 곳이 바로 그곳입니다 — 거기서 나는 실패는 반드시 누가 봐야 합니다.
 *
 * ## 그렇다고 운영과 같은 등급으로 부르면 안 됩니다
 *
 * 스테이징의 실패를 `critical`로 울리면, **진짜 운영 장애가 그 속에
 * 묻힙니다.** 검증 스프린트 기간에는 스테이징에서 실패를 일부러 만들기까지
 * 합니다.
 *
 * 그래서 세 단계를 다르게 다룹니다:
 *
 * | | 경보 | 실패 등급 | 요구 사항 |
 * | --- | --- | --- | --- |
 * | development | 내지 않음 | — | 최소 (DB·저장소만) |
 * | staging | **낸다** | `warning` | 운영과 같은 항목, 낮은 등급 |
 * | production | 낸다 | `critical` | 전부 |
 */

import type { DeploymentTier } from "./validation-target";

export interface TierPolicy {
  tier: DeploymentTier;
  title: string;
  /** 이 단계에서 진단 결과를 경보로 내는가 */
  alerting: boolean;
  /** 실패가 났을 때 경보 등급 */
  failLevel: "warning" | "critical";
  /**
   * 환경변수·긴급 경로처럼 **운영 구성**에 해당하는 항목을 요구하는가.
   * 개발에서 요구하면 그 경고가 배경 소음이 되고, 그러면 정작 운영의
   * 경고도 안 읽힙니다 (정책 4001-④에서 세운 원칙).
   */
  requiresOperationalConfig: boolean;
  detail: string;
}

export const TIER_POLICIES: Record<DeploymentTier, TierPolicy> = {
  development: {
    tier: "development",
    title: "개발",
    alerting: false,
    failLevel: "warning",
    requiresOperationalConfig: false,
    detail:
      "개발에서는 진단 결과를 경보로 내지 않습니다 — 개발자 노트북의 " +
      "빨간불까지 부르면 그 채널 전체가 무시됩니다.",
  },
  staging: {
    tier: "staging",
    title: "스테이징",
    alerting: true,
    // **운영과 같은 등급으로 울리지 않는다** — 검증 기간에는 여기서
    // 실패를 일부러 만들기까지 한다
    failLevel: "warning",
    requiresOperationalConfig: true,
    detail:
      "스테이징의 빨간불은 누가 봐야 합니다 — 아무 데도 안 가면 스테이징은 " +
      "검증 환경이 아니라 또 하나의 개발 환경입니다. 다만 등급은 운영보다 " +
      "낮게 둡니다: 여기서 나는 실패가 운영 장애를 덮으면 안 됩니다.",
  },
  production: {
    tier: "production",
    title: "운영",
    alerting: true,
    failLevel: "critical",
    requiresOperationalConfig: true,
    detail: "운영의 실패는 즉시 알립니다.",
  },
};

/** 이 단계의 정책 (순수 함수) */
export function tierPolicy(tier: DeploymentTier): TierPolicy {
  return TIER_POLICIES[tier];
}

/**
 * 단계 선언과 실제 구성이 어긋났는가 (순수 함수, CTO 정책 4101-③).
 *
 * `DEPLOY_TIER=staging`인데 `NODE_ENV`가 `production`이 아니면, Node 쪽
 * 최적화·보안 기본값이 개발 모드로 도는 스테이징입니다. 그런 스테이징에서
 * 잰 성능·동작은 **운영의 그것이 아닙니다** — 검증 결과가 제품의 결과인지
 * 설정의 결과인지 나중에 가릴 수 없게 됩니다.
 *
 * 반대(`NODE_ENV=production`인데 `DEPLOY_TIER`가 없음)는 **경고만**
 * 합니다: 그때는 운영으로 판정되므로 위험한 쪽으로 기울지 않습니다.
 */
export function checkTierConsistency(input: {
  tier: DeploymentTier;
  nodeEnv: string | undefined;
  tierDeclared: boolean;
}): {
  id: string;
  title: string;
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
  next: string | null;
} {
  const nodeEnv = (input.nodeEnv ?? "").trim().toLowerCase();
  const id = "deploy-tier";
  const title = "배포 단계 선언";

  if (!input.tierDeclared) {
    return {
      id,
      title,
      status: nodeEnv === "production" ? "warn" : "ok",
      detail:
        nodeEnv === "production"
          ? "DEPLOY_TIER가 없어 NODE_ENV=production을 보고 운영으로 " +
            "판정했습니다 — 스테이징이라면 지금 운영 등급으로 경보가 나갑니다."
          : "DEPLOY_TIER가 없어 개발로 판정했습니다.",
      next:
        nodeEnv === "production"
          ? "DEPLOY_TIER=staging 또는 production을 명시하세요."
          : null,
    };
  }

  if (
    (input.tier === "staging" || input.tier === "production") &&
    nodeEnv !== "production"
  ) {
    return {
      id,
      title,
      status: "fail",
      detail:
        `DEPLOY_TIER=${input.tier}인데 NODE_ENV=${nodeEnv || "(없음)"}입니다 — ` +
        "개발 모드로 도는 환경에서 잰 값은 운영의 값이 아닙니다. 검증 " +
        "결과가 제품의 결과인지 설정의 결과인지 나중에 가릴 수 없습니다.",
      next: "NODE_ENV=production을 함께 두세요.",
    };
  }

  return {
    id,
    title,
    status: "ok",
    detail: `${TIER_POLICIES[input.tier].title} 단계로 돌고 있습니다.`,
    next: null,
  };
}
