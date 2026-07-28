import type { Experiment, ExperimentVariant } from "./experiment";
import { pickVariant, variantKey } from "./experiment";

/**
 * Sticky Assignment & Experiment Lifecycle. (TASK-1101, Sprint 11)
 *
 * TASK-1003의 실험은 호출마다 독립 추첨이라 같은 프로젝트가 매번 다른 변형을
 * 받을 수 있었다. 여기서는 두 가지를 더한다:
 *
 * - **Sticky Assignment**: 같은 프로젝트는 항상 같은 변형을 받는다.
 *   배정은 **결정적 해시**(실험 정의 + projectId)로 정해지므로 저장소가
 *   없어도, 여러 인스턴스에서도 같은 결과가 나온다. 저장은 관측·감사용이다.
 * - **Lifecycle**: RUNNING → STOPPED(중단) / PROMOTED(승자 확정) 전이와
 *   Rollback(직전 상태 복원). 정의(변형·가중치)는 환경변수가 원천이고
 *   (CTO 결정 1003-② 표기법 확정), 여기서는 **운영 중 바뀌는 상태**만 다룬다.
 */

export const EXPERIMENT_STATUSES = ["RUNNING", "STOPPED", "PROMOTED"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const EXPERIMENT_ACTIONS = [
  "START",
  "STOP",
  "PROMOTE",
  "ROLLBACK",
] as const;
export type ExperimentAction = (typeof EXPERIMENT_ACTIONS)[number];

/**
 * 실험 정의의 서명 — 변형 구성이 바뀌었는지 판별한다.
 * 이름·종류는 제외한다(표시용 메타데이터일 뿐 배정에 영향이 없다 —
 * CTO 결정 1003-③). 변형 목록·가중치가 바뀌면 서명이 바뀌고,
 * 기존 Sticky 배정은 무효가 되어 다시 배정된다.
 */
export function experimentSignature(experiment: Experiment): string {
  return experiment.variants
    .map((variant) => `${variantKey(variant)}=${variant.weight}`)
    .join(",");
}

/**
 * 문자열 → [0, 1) 실수. 같은 입력이면 언제 어디서나 같은 값이 나온다
 * (인스턴스·재기동과 무관한 Sticky 배정의 근거).
 *
 * FNV-1a로 누적한 뒤 **MurmurHash3의 최종 혼합(fmix32)** 을 한 번 더 돌린다.
 * FNV만 쓰면 `proj-1`, `proj-2`처럼 **연속적인 키가 비슷한 값으로 뭉쳐**
 * 배정이 한쪽으로 쏠린다(프로젝트 ID가 순번인 환경에서 실제로 발생). 혼합
 * 단계가 하위 비트 변화를 전체 비트로 퍼뜨려 이 쏠림을 없앤다.
 */
export function hashToUnitInterval(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    // FNV 소수 곱 (32비트 오버플로 유지)
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // fmix32 — 눈사태 효과 보강
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}

export interface StickyAssignmentInput {
  experiment: Experiment;
  /** 배정 주체 — 프로젝트 식별자 (CTO 결정: Project 기반) */
  projectId: string;
  availableProviders: string[];
  /** 이미 저장된 배정 (있으면 우선) */
  existing?: { variantKey: string; signature: string } | null;
}

export interface StickyAssignment {
  variant: ExperimentVariant;
  key: string;
  /** 저장된 배정을 그대로 쓴 경우 true */
  reused: boolean;
  /** 이 배정이 만들어진 실험 정의 서명 */
  signature: string;
}

/**
 * Project 기반 Sticky 배정.
 *
 * 1. 저장된 배정이 있고 **서명이 같고** 그 변형을 아직 쓸 수 있으면 재사용
 * 2. 아니면 `해시(서명 + projectId)`로 결정적 추첨 — 저장 실패·재기동과
 *    무관하게 같은 프로젝트는 같은 변형을 받는다
 *
 * 사용 가능한 변형이 없으면 null (호출자는 기존 라우팅으로 처리).
 */
export function assignSticky(
  input: StickyAssignmentInput,
): StickyAssignment | null {
  const signature = experimentSignature(input.experiment);
  const usable = input.experiment.variants.filter((variant) =>
    input.availableProviders.includes(variant.provider),
  );
  if (usable.length === 0) {
    return null;
  }

  if (input.existing && input.existing.signature === signature) {
    const found = usable.find(
      (variant) => variantKey(variant) === input.existing?.variantKey,
    );
    if (found) {
      return {
        variant: found,
        key: variantKey(found),
        reused: true,
        signature,
      };
    }
  }

  const picked = pickVariant(input.experiment.variants, {
    availableProviders: input.availableProviders,
    random: () => hashToUnitInterval(`${signature}|${input.projectId}`),
  });
  return picked
    ? { variant: picked.variant, key: picked.key, reused: false, signature }
    : null;
}

export interface LifecycleState {
  status: ExperimentStatus;
  promotedVariant: string | null;
}

export interface LifecycleTransition extends LifecycleState {
  action: ExperimentAction;
  from: LifecycleState;
}

export class ExperimentLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentLifecycleError";
  }
}

/**
 * 상태 전이 규칙 (순수 로직).
 *
 * - START: 어느 상태에서든 RUNNING으로. 승자 지정은 해제된다
 * - STOP: 어느 상태에서든 STOPPED로 (이미 STOPPED면 그대로)
 * - PROMOTE: 승자 변형을 지정하고 PROMOTED로. 변형은 **현재 정의에 있어야**
 *   한다 (없는 변형으로 승격하면 라우팅이 깨진다)
 * - ROLLBACK: 직전 상태로 복원 — `previous`가 없으면 RUNNING으로 되돌린다
 */
export function applyLifecycleAction(input: {
  current: LifecycleState;
  action: ExperimentAction;
  /** PROMOTE 대상 변형 키 */
  variantKey?: string | null;
  /** ROLLBACK이 복원할 직전 상태 */
  previous?: LifecycleState | null;
  /** 현재 실험 정의의 변형 키 (PROMOTE 검증용) */
  availableVariants?: string[];
}): LifecycleTransition {
  const from: LifecycleState = { ...input.current };

  switch (input.action) {
    case "START":
      return {
        action: "START",
        from,
        status: "RUNNING",
        promotedVariant: null,
      };
    case "STOP":
      return {
        action: "STOP",
        from,
        status: "STOPPED",
        // 중단해도 승자 기록은 남긴다 (다시 START하면 해제)
        promotedVariant: from.promotedVariant,
      };
    case "PROMOTE": {
      const target = (input.variantKey ?? "").trim();
      if (!target) {
        throw new ExperimentLifecycleError(
          "승격할 변형(variantKey)을 지정해 주세요.",
        );
      }
      if (
        input.availableVariants &&
        !input.availableVariants.includes(target)
      ) {
        throw new ExperimentLifecycleError(
          `변형 "${target}"은 현재 실험 정의에 없습니다 (${input.availableVariants.join(", ")}).`,
        );
      }
      return {
        action: "PROMOTE",
        from,
        status: "PROMOTED",
        promotedVariant: target,
      };
    }
    case "ROLLBACK": {
      const restored = input.previous ?? {
        status: "RUNNING" as const,
        promotedVariant: null,
      };
      return {
        action: "ROLLBACK",
        from,
        status: restored.status,
        promotedVariant: restored.promotedVariant,
      };
    }
    default:
      throw new ExperimentLifecycleError(
        `알 수 없는 동작입니다: ${String(input.action)}`,
      );
  }
}

/**
 * 상태에 따라 실험을 어떻게 적용할지 결정한다.
 * - RUNNING: 배정 진행
 * - STOPPED: 적용하지 않음 (기존 라우팅)
 * - PROMOTED: 배정 없이 **승자 변형으로 전 트래픽** (실험 종료 후 정착)
 */
export function resolveLifecycle(
  state: LifecycleState,
  experiment: Experiment,
  availableProviders: string[],
):
  | { mode: "assign" }
  | { mode: "skip"; reason: string }
  | { mode: "promoted"; variant: ExperimentVariant } {
  if (state.status === "STOPPED") {
    return { mode: "skip", reason: "실험이 중단되어 기존 라우팅으로 처리합니다." };
  }
  if (state.status === "PROMOTED") {
    const winner = experiment.variants.find(
      (variant) => variantKey(variant) === state.promotedVariant,
    );
    if (!winner) {
      return {
        mode: "skip",
        reason: `승자 변형 "${state.promotedVariant}"이 현재 정의에 없어 기존 라우팅으로 처리합니다.`,
      };
    }
    if (!availableProviders.includes(winner.provider)) {
      return {
        mode: "skip",
        reason: `승자 변형 "${state.promotedVariant}"의 Provider를 사용할 수 없어 기존 라우팅으로 처리합니다.`,
      };
    }
    return { mode: "promoted", variant: winner };
  }
  return { mode: "assign" };
}
