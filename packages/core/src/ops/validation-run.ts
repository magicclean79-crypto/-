/**
 * 검증 실행 준비와 그 잠금. (TASK-4101, Sprint 41 — CTO 정책 4101-⑤⑥)
 *
 * TASK-4001은 준비 상태를 **판정**했습니다. 이번에 더하는 것은 두 가지입니다:
 *
 * 1. **실행 순서** (정책 ⑤) — 준비가 끝난 순간 무엇을 어떤 순서로 돌릴지.
 *    준비만 하고 순서를 안 적어 두면, 정작 그날 사람이 "이제 뭐부터 하지"를
 *    다시 정하게 되고 그때 빠뜨립니다.
 * 2. **잠금** (정책 ⑥) — 준비되지 않았는데 도는 것을 **막습니다.**
 *
 * ## 왜 잠그는가
 *
 * 정책 ⑥은 "준비된 이후에만 수행한다"입니다. 이것을 문서로만 적어 두면
 * 규칙이 되고, **사람의 기억에 기대는 규칙은 반드시 다시 어긋납니다.**
 * 실제로 일어나는 모습은 이렇습니다: 검증 스프린트 날짜가 잡히고, 자격
 * 증명은 아직 안 왔는데, 누군가 "일단 돌려 보자"고 버튼을 누릅니다. 그러면
 * 스텁을 상대로 한 성공 기록이 남고, 그 기록은 나중에 **실연결의 증거로
 * 읽힙니다.**
 *
 * 그래서 코드가 막습니다. 그리고 **막힌 이유를 그대로 말합니다** — 막기만
 * 하고 이유를 안 말하면 사람은 우회로를 찾습니다.
 *
 * ## 강제로 여는 길을 두지 않습니다
 *
 * `--force` 같은 것을 두면 그것이 기본 사용법이 됩니다. 대신 **막는 조건
 * 자체를 없애는 것**이 유일한 길입니다: 자격 증명을 넣고, 길을 열고,
 * 검증 대상을 확인하는 것.
 */

import type { ValidationReadiness } from "./validation-plan";
import type { ValidationTargetVerdict } from "./validation-target";

/** 검증 스프린트 당일에 도는 순서 (CTO 정책 4101-⑤) */
export interface ValidationRunStep {
  order: number;
  id: string;
  title: string;
  /** 실제로 무엇을 부르는가 */
  command: string;
  /** 이 단계가 실패하면 어떻게 하는가 */
  onFailure: string;
  /** 되돌릴 수 있는가 — 없으면 그 사실을 적는다 */
  reversible: boolean;
}

/**
 * 실행 순서 — **되돌릴 수 없는 것을 마지막에** 둡니다.
 *
 * 순서를 이렇게 두는 이유: 앞 단계는 전부 읽기·시험이고, 실제로 외부에 돈이
 * 나가고 흔적이 남는 것은 스모크부터입니다. 되돌릴 수 없는 것을 먼저 하면
 * 앞에서 발견했을 문제를 뒤에서 발견하게 됩니다.
 */
export const VALIDATION_RUN_STEPS: ValidationRunStep[] = [
  {
    order: 1,
    id: "preflight",
    title: "준비 상태 재확인",
    command: "GET /ops/validation-plan",
    onFailure: "여기서 멈춥니다 — 준비가 끝나지 않았으면 아래는 의미가 없습니다.",
    reversible: true,
  },
  {
    order: 2,
    id: "diagnostics",
    title: "대상 환경 진단",
    command: "GET /ops/diagnostics?stage=startup",
    onFailure:
      "실패 항목을 고친 뒤 다시 시작합니다. 설정 문제를 안고 검증하면 " +
      "결과가 제품의 것인지 설정의 것인지 가릴 수 없습니다.",
    reversible: true,
  },
  {
    order: 3,
    id: "baseline",
    title: "검증 전 KPI 스냅샷",
    command: "POST /ops/kpi/snapshot",
    onFailure: "기준선 없이 시작하면 끝나고 나서 비교할 대상이 없습니다.",
    reversible: true,
  },
  {
    order: 4,
    id: "smoke",
    title: "실 호출 스모크 3종",
    command: "POST /ops/smoke",
    onFailure:
      "실패한 대상의 자격 증명·주소를 확인합니다. 스텁으로 되돌려 통과시키지 " +
      "않습니다 — 그러면 검증하지 않은 것과 같습니다.",
    // 여기서부터 외부에 흔적이 남고 돈이 나간다
    reversible: false,
  },
  {
    order: 5,
    id: "cutover",
    title: "전환 검증",
    command: "GET /ops/cutover",
    onFailure: "not-production이 남아 있으면 전환된 것이 아닙니다.",
    reversible: true,
  },
  {
    order: 6,
    id: "observe",
    title: "관측 기간 (최소 1일)",
    command: "GET /ops/kpi/trend",
    onFailure:
      "추세를 낼 수 없으면 검증 전후를 비교할 수 없습니다 — 스냅샷이 두 점 " +
      "쌓일 때까지 기다립니다.",
    reversible: true,
  },
  {
    order: 7,
    id: "rollback-drill",
    title: "되돌리기 확인",
    command: "POST /ops/drills",
    onFailure: "되돌릴 수 없으면 이것은 검증이 아니라 그냥 전환입니다.",
    reversible: true,
  },
];

export type RunGateVerdict = "allowed" | "blocked";

export interface RunGate {
  verdict: RunGateVerdict;
  /** 막은 이유 — 허용이면 빈 배열 */
  blockers: { id: string; reason: string }[];
  steps: ValidationRunStep[];
  detail: string;
}

/**
 * 지금 검증을 실행해도 되는가 (순수 함수, CTO 정책 4101-⑥).
 *
 * **강제로 여는 인자를 받지 않습니다.** 그런 것을 두면 그것이 기본
 * 사용법이 됩니다 — 막는 조건 자체를 없애는 것이 유일한 길입니다.
 */
export function judgeRunGate(input: {
  readiness: ValidationReadiness;
  /** 준비 판정이 말하는 미완 단계 */
  waitingOnPeople: string[];
  waitingOnUs: string[];
  blockedSteps: string[];
  /** 검증 대상 판정 */
  target: ValidationTargetVerdict;
  /** 지금 이 인스턴스의 배포 단계 */
  tier: string;
}): RunGate {
  const blockers: { id: string; reason: string }[] = [];

  if (input.target !== "accepted") {
    blockers.push({
      id: "target",
      reason:
        input.target === "unset"
          ? "검증 대상이 정해지지 않았습니다 — 어디에 돌릴지 모르는 채로 " +
            "시작할 수 없습니다."
          : `검증 대상 판정이 '${input.target}'입니다 — 대상이 성립하지 ` +
            "않으면 실 호출을 돌리지 않습니다.",
    });
  }

  // **운영에서 검증 실행을 걸지 않습니다** — 검증은 대상 환경에서 돕니다
  if (input.tier === "production") {
    blockers.push({
      id: "tier",
      reason:
        "이 인스턴스는 운영입니다. 검증 스프린트는 대상 환경에서 돌려야 " +
        "하고, 운영에서 실패를 만들어 보는 것은 검증이 아닙니다.",
    });
  }

  if (input.readiness !== "ready") {
    if (input.waitingOnPeople.length > 0) {
      blockers.push({
        id: "people",
        reason:
          `사람이 줘야 끝나는 단계가 ${input.waitingOnPeople.length}건 ` +
          `남았습니다: ${input.waitingOnPeople.join(" · ")}. 이 단계들은 ` +
          "코드로 해결되지 않습니다.",
      });
    }
    if (input.waitingOnUs.length > 0) {
      blockers.push({
        id: "us",
        reason:
          `우리가 할 수 있는데 아직 안 한 단계가 ${input.waitingOnUs.length}건 ` +
          `남았습니다: ${input.waitingOnUs.join(" · ")}.`,
      });
    }
    if (input.blockedSteps.length > 0) {
      blockers.push({
        id: "blocked",
        reason:
          `앞 단계에 막힌 단계가 ${input.blockedSteps.length}건 있습니다: ` +
          `${input.blockedSteps.join(" · ")}.`,
      });
    }
    if (blockers.every((row) => row.id === "target" || row.id === "tier")) {
      // readiness가 ready가 아닌데 위 셋 중 아무것도 안 잡혔다면, 판정을
      // 읽지 못한 것이다 — 그것도 통과 사유가 아니다
      blockers.push({
        id: "readiness",
        reason: `준비 판정이 '${input.readiness}'입니다.`,
      });
    }
  }

  if (blockers.length === 0) {
    return {
      verdict: "allowed",
      blockers,
      steps: VALIDATION_RUN_STEPS,
      detail:
        `검증을 시작할 수 있습니다 — ${VALIDATION_RUN_STEPS.length}단계 순서를 ` +
        "따르세요. 4단계(실 호출 스모크)부터는 외부에 흔적이 남고 돈이 " +
        "나갑니다.",
    };
  }

  return {
    verdict: "blocked",
    blockers,
    steps: VALIDATION_RUN_STEPS,
    detail:
      `검증을 시작할 수 없습니다 (${blockers.length}건). ` +
      blockers.map((row) => row.reason).join(" ") +
      " 강제로 여는 방법은 없습니다 — 막는 조건을 없애는 것이 유일한 " +
      "길입니다. 준비되지 않은 채 돌리면 스텁을 상대로 한 성공 기록이 " +
      "남고, 그 기록은 나중에 실연결의 증거로 읽힙니다.",
  };
}
