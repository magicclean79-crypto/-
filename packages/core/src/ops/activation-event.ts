/**
 * 운영 활성화 이벤트. (TASK-3801, Sprint 38 — CTO 정책 3801-①)
 *
 * TASK-3701은 활성화 **상태**와 **이력**을 만들었습니다. 그런데 이력은
 * **보러 가야 보입니다.** 전환은 몇 주에 걸쳐 조건이 하나씩 채워지는
 * 과정이고, 마지막 조건이 채워지는 순간은 대개 **아무도 화면을 보고 있지
 * 않을 때** 옵니다 — 방화벽 담당자가 규칙을 열었거나, 결제가 풀렸거나,
 * CI가 마침내 초록이 됐을 때. 그 순간을 아무도 모르면, 운영은 **이미 켤 수
 * 있게 된 상태로 며칠을 더 놀립니다.**
 *
 * 그래서 상태가 바뀌는 그 자리에서 이벤트를 만듭니다.
 *
 * ## 완료만 알리지 않는 이유
 *
 * 정책은 "Activation Complete 자동 이벤트"를 말합니다. 완료만 알리면
 * **풀린 것은 조용히 지나갑니다** — 그리고 풀린 것이 훨씬 급한 소식입니다.
 * 키는 만료되고 방화벽 규칙은 정리 작업에 지워집니다. 활성화됐다가 조건이
 * 빠지는 것은 "아직 안 됨"과 전혀 다른 사건이고(되던 것이 안 되는 것),
 * 완료를 알리는 장치가 그것만 침묵한다면 그 장치는 **좋은 소식 전용**이
 * 됩니다. 좋은 소식만 전하는 알림은 아무도 신뢰하지 않습니다.
 *
 * ## 한 번만 난다
 *
 * `/ops/activation`은 화면을 열 때마다 불립니다. 상태가 유지되는 동안
 * 이벤트가 계속 나면 알림은 소음이 되고, 소음이 된 알림은 꺼집니다.
 * 그래서 이벤트는 **전이(transition)** 에서만 나고, 같은 전이는 지문으로
 * 한 번만 납니다.
 *
 * ## 이벤트는 감사 기록이 아니다
 *
 * 이벤트는 **시스템이 관측한 상태 변화**이고, 감사 기록(정책 3801-④)은
 * **사람이 한 일**입니다. 둘을 한 표에 섞으면 "누가 했나"와 "무엇이
 * 일어났나"를 다시 손으로 갈라야 합니다.
 */

import type { ActivationConditionId } from "./activation";

export const ACTIVATION_EVENT_KINDS = [
  /** 세 조건이 모두 충족됐다 — 이제 운영으로 볼 수 있다 */
  "activation-completed",
  /** 충족돼 있던 조건이 빠졌다 — 되던 것이 안 된다 */
  "activation-lost",
] as const;
export type ActivationEventKind = (typeof ACTIVATION_EVENT_KINDS)[number];

export interface ActivationEvent {
  kind: ActivationEventKind;
  /** 같은 전이를 두 번 알리지 않기 위한 키 */
  key: string;
  title: string;
  message: string;
  /** 이 이벤트가 급한가 — 풀린 것은 급하다 */
  urgent: boolean;
  /** 판정 근거 — 어떤 조건이 움직였나 */
  changed: ActivationConditionId[];
}

/** 전이를 판정하기 위해 필요한 최소한의 상태 */
export interface ActivationSnapshot {
  activated: boolean;
  /** 충족된 조건 */
  met: ActivationConditionId[];
  environment: string;
  /** 이 환경에서 활성화를 판정할 이유가 있는가 (정책 3501-①) */
  applicable: boolean;
}

const CONDITION_TITLES: Record<ActivationConditionId, string> = {
  credentials: "자격 증명",
  network: "네트워크",
  cutover: "전환 판정",
};

function names(ids: ActivationConditionId[]): string {
  return ids.map((id) => CONDITION_TITLES[id]).join(" · ");
}

/**
 * 상태 전이를 이벤트로 (순수 함수, CTO 정책 3801-①).
 *
 * `previous`가 `null`이면 **처음 관측**입니다. 이때는 이벤트를 내지
 * 않습니다 — 우리가 못 보고 있는 동안 이미 그 상태였을 수 있고, "방금
 * 완료됐다"고 알리면 거짓말이 됩니다. **모르는 것을 사건으로 만들지
 * 않습니다.**
 *
 * 전환 대상이 아닌 환경(개발)에서도 내지 않습니다 — 개발자의 로컬이
 * 초록이 됐다고 운영에 알림이 가면, 그다음부터 아무도 그 알림을 안 봅니다
 * (정책 3501-①과 같은 판단).
 */
export function judgeActivationEvent(
  previous: ActivationSnapshot | null,
  current: ActivationSnapshot,
): ActivationEvent | null {
  if (previous === null) {
    return null;
  }
  if (!current.applicable) {
    return null;
  }

  const gained = current.met.filter((id) => !previous.met.includes(id));
  const lost = previous.met.filter((id) => !current.met.includes(id));

  if (!previous.activated && current.activated) {
    return {
      kind: "activation-completed",
      key: `activation-completed:${current.environment}:${[...current.met].sort().join(",")}`,
      title: "운영 활성화 완료",
      message:
        `자격 증명 · 네트워크 · 전환 판정 세 조건이 모두 충족됐습니다 ` +
        `(${current.environment}). ` +
        (gained.length > 0 ? `마지막으로 채워진 조건: ${names(gained)}. ` : "") +
        "이제 실 Provider로 전환할 수 있습니다 — 전환 직후 스모크를 1회 " +
        "돌려 실제 호출이 되는지 확인하세요.",
      urgent: false,
      changed: gained,
    };
  }

  if (previous.activated && !current.activated) {
    return {
      kind: "activation-lost",
      key: `activation-lost:${current.environment}:${[...lost].sort().join(",")}`,
      title: "운영 활성화가 풀렸습니다",
      message:
        `충족돼 있던 조건이 빠졌습니다: ${names(lost)} (${current.environment}). ` +
        "되던 것이 안 되는 상태입니다 — 키 만료·방화벽 규칙 정리처럼 " +
        "조용히 풀리는 원인을 먼저 확인하세요.",
      // 풀린 것은 급하다. 완료보다 이쪽이 먼저다.
      urgent: true,
      changed: lost,
    };
  }

  // 조건이 늘거나 줄었지만 활성화 여부가 그대로인 경우는 이벤트가 아니다 —
  // 진행 상황은 이력이 담당하고, 알림은 **경계를 넘을 때만** 낸다.
  return null;
}
