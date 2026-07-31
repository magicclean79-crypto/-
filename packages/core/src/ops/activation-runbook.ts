/**
 * 운영 활성화 런북. (TASK-4401, Sprint 44 — CTO 정책 4401-⑤)
 *
 * 준비 단계(4001-⑥)는 **시작해도 되는가**에 답합니다. 런북은 그다음
 * 질문에 답합니다 — **시작한 다음 무엇을 어떤 순서로 하고, 잘못되면 어떻게
 * 되돌리는가.**
 *
 * ## 체크리스트와 런북의 차이
 *
 * 체크리스트는 "했는가"를 묻습니다. 런북은 세 가지를 더 적어야 합니다:
 *
 * 1. **되돌리는 법.** 되돌릴 수 없는 단계라면 **되돌릴 수 없다고** 적어야
 *    합니다. 되돌리는 법이 안 적힌 단계는, 사고가 났을 때 그 자리에서
 *    지어내게 됩니다.
 * 2. **누가 하는가.** 사람이 줘야 하는 것과 우리가 하는 것이 섞이면 "왜
 *    아직 안 됐지"의 답이 매번 달라집니다.
 * 3. **무엇이 증거인가.** 증거를 미리 적어 두지 않으면 나중에 "아마 됐을
 *    것"이 증거 자리에 들어옵니다.
 *
 * ## 이 파일은 새로 판정하지 않습니다
 *
 * 각 단계의 지금 상태는 **이미 있는 판정을 인용**합니다(정책 4301-④와 같은
 * 규칙). 런북이 자기 판정을 만들면 준비 화면과 다른 말을 하게 되고, 둘이
 * 어긋나는 순간 사람은 둘 다 안 믿습니다.
 */

/** 런북 단계의 상태 — 인용해 온 값 */
export type RunbookState = "done" | "pending" | "blocked" | "unknown";

export interface RunbookStep {
  id: string;
  title: string;
  /** 사람이 하는가, 시스템이 하는가 */
  owner: "system" | "operator";
  /** 왜 이 순서인가 */
  why: string;
  /** 무엇을 보면 됐다고 하는가 */
  evidence: string;
  /**
   * 되돌리는 법. **되돌릴 수 없으면 그렇게 적습니다** — 빈칸으로 두면
   * 사고가 났을 때 그 자리에서 지어내게 됩니다.
   */
  rollback: string;
  /** 이 단계부터 외부에 흔적이 남고 돈이 나간다 */
  irreversible: boolean;
  /** 어느 판정에서 상태를 가져오는가 */
  source: string;
}

/**
 * 운영 활성화 순서 (CTO 정책 4401-⑤).
 *
 * **되돌릴 수 없는 것을 뒤에** 둡니다(정책 4101-⑤와 같은 원칙). 앞은 전부
 * 읽기·확인이고, 실제로 외부에 흔적이 남는 것은 실 호출부터입니다.
 */
export const RUNBOOK_STEPS: RunbookStep[] = [
  {
    id: "preflight",
    title: "사전 점검 통과",
    owner: "system",
    why:
      "무엇이 막고 있는지 모른 채 시작하면, 실패했을 때 그것이 준비 부족인지 " +
      "제품 결함인지 가릴 수 없습니다.",
    evidence: "pnpm validation:preflight가 exit 0입니다.",
    rollback: "아무것도 바꾸지 않는 단계입니다 — 되돌릴 것이 없습니다.",
    irreversible: false,
    source: "GET /ops/readiness-board",
  },
  {
    id: "credentials",
    title: "실 Provider 자격 증명 주입",
    owner: "operator",
    why: "실 호출 없이 재는 모든 숫자는 스텁의 숫자입니다.",
    evidence: "GET /ops/activation의 credentials 조건이 충족입니다.",
    rollback:
      "환경변수를 비우고 재기동하면 즉시 스텁으로 돌아갑니다. 이미 나간 " +
      "호출의 과금은 되돌릴 수 없습니다.",
    irreversible: false,
    source: "GET /ops/activation",
  },
  {
    id: "egress",
    title: "공식 주소로 나가는 길 열기",
    owner: "operator",
    why:
      "키가 틀린 것과 길이 막힌 것은 다른 문제입니다. 길이 막혀 있으면 " +
      "올바른 키를 넣어도 실패하고, 그 실패는 키 문제로 잘못 읽힙니다.",
    evidence: "GET /ops/cutover의 도달 점검이 unreachable에서 벗어납니다.",
    rollback: "허용 규칙을 되돌리면 다시 막힙니다.",
    irreversible: false,
    source: "GET /ops/cutover",
  },
  {
    id: "host-inventory",
    title: "운영 호스트 목록 확정",
    owner: "operator",
    why:
      "검증 대상 보호는 이 목록과 대조해 동작합니다. 목록이 비어 있거나 " +
      "빠진 도메인이 있으면 보호는 위험한 주소를 막는 것이 아니라 그냥 " +
      "통과시키고 있는 것입니다.",
    evidence: "GET /ops/hosts에서 목록에 없는데 쓰이는 호스트가 0개입니다.",
    rollback: "목록은 언제든 고칠 수 있습니다.",
    irreversible: false,
    source: "GET /ops/hosts",
  },
  {
    id: "smoke",
    title: "실 호출 스모크 3종",
    owner: "system",
    why:
      "스텁 통과는 계약 확인이지 연결 확인이 아닙니다. 실제로 한 번씩 " +
      "불러 봐야 압니다.",
    evidence: "POST /ops/smoke가 세 대상 모두 passed이고 stubbed가 0건입니다.",
    rollback:
      "되돌릴 수 없습니다 — 이 단계부터 외부에 요청이 나가고 과금됩니다. " +
      "중단은 할 수 있지만 이미 나간 호출은 취소되지 않습니다.",
    irreversible: true,
    source: "GET /ops/smoke",
  },
  {
    id: "cutover",
    title: "실 Provider 전환 검증",
    owner: "system",
    why: "성공 기록이 있어도 상대가 스텁이었으면 전환된 것이 아닙니다.",
    evidence: "GET /ops/cutover의 모든 대상이 verified이고 not-production이 0건입니다.",
    rollback:
      "Provider 설정을 이전 값으로 되돌리고 재기동하면 새 요청은 스텁으로 " +
      "갑니다. 다만 전환 이후에 나간 요청은 되돌릴 수 없습니다 — 이미 " +
      "외부에 남았고 과금됐습니다.",
    irreversible: true,
    source: "GET /ops/cutover",
  },
  {
    id: "observe",
    title: "전환 후 관측 창 유지",
    owner: "system",
    why:
      "전환 직후의 정상은 아직 아무것도 안 해 본 정상입니다. 하루는 지나야 " +
      "실패율·비용·지연이 사람의 판단 대상이 됩니다.",
    evidence: "KPI 스냅샷이 전환 전후로 각각 있고, 추세를 낼 수 있습니다.",
    rollback: "관측은 아무것도 바꾸지 않습니다.",
    irreversible: false,
    source: "GET /ops/kpi/trend",
  },
  {
    id: "rollback-drill",
    title: "되돌리는 절차 확인",
    owner: "operator",
    why:
      "실 Provider로 바꾼 뒤 문제가 생겼을 때 되돌릴 수 없다면, 그건 " +
      "검증이 아니라 그냥 전환입니다.",
    evidence: "최근 복구 리허설 기록이 있고 그 절차가 이번 전환에도 적용됩니다.",
    rollback: "이 단계 자체가 되돌리는 절차입니다.",
    irreversible: false,
    source: "GET /ops/drills",
  },
];

export interface RunbookStepState extends RunbookStep {
  state: RunbookState;
  detail: string;
}

export interface RunbookReport {
  steps: RunbookStepState[];
  done: number;
  total: number;
  /** 지금 할 수 있는 다음 단계 — 없으면 null */
  nextStep: RunbookStepState | null;
  /** 되돌릴 수 없는 단계가 시작됐는가 */
  irreversibleStarted: boolean;
  /** 사람이 줘야 끝나는 미완 단계 */
  waitingOnPeople: string[];
  detail: string;
}

/**
 * 런북의 지금 상태를 만든다 (순수 함수, CTO 정책 4401-⑤).
 *
 * `states`는 **이미 있는 판정에서 가져온 값**입니다. 못 가져온 단계는
 * `unknown`이며 **통과로 세지 않습니다.**
 */
export function buildRunbook(input: {
  states: Record<string, { state: RunbookState; detail: string }>;
}): RunbookReport {
  const steps: RunbookStepState[] = RUNBOOK_STEPS.map((step) => {
    const found = input.states[step.id];
    return {
      ...step,
      state: found?.state ?? "unknown",
      detail:
        found?.detail ??
        "이 단계의 상태를 읽지 못했습니다 — 됐다는 뜻이 아닙니다.",
    };
  });

  const done = steps.filter((step) => step.state === "done").length;
  // **앞 단계가 끝나지 않으면 다음 단계가 아닙니다.** 순서를 건너뛰고
  // "지금 할 수 있는 일"을 고르면, 되돌릴 수 없는 단계가 앞으로 당겨집니다.
  const nextStep = steps.find((step) => step.state !== "done") ?? null;
  const irreversibleStarted = steps.some(
    (step) => step.irreversible && step.state !== "pending" && step.state !== "unknown",
  );
  const waitingOnPeople = steps
    .filter((step) => step.owner === "operator" && step.state !== "done")
    .map((step) => step.title);

  const parts: string[] = [`운영 활성화 런북 ${done}/${steps.length} 단계 완료.`];
  if (nextStep === null) {
    parts.push("모든 단계에 증거가 있습니다.");
  } else {
    parts.push(
      `다음 단계는 "${nextStep.title}"입니다` +
        (nextStep.irreversible
          ? " — 이 단계부터 되돌릴 수 없습니다(외부에 흔적이 남고 과금됩니다)."
          : "."),
    );
  }
  if (waitingOnPeople.length > 0) {
    parts.push(
      `사람이 줘야 끝나는 단계 ${waitingOnPeople.length}건: ` +
        `${waitingOnPeople.join(" · ")}. 이 단계들은 코드로 해결되지 않습니다.`,
    );
  }
  const unknown = steps.filter((step) => step.state === "unknown");
  if (unknown.length > 0) {
    parts.push(
      `상태를 읽지 못한 단계 ${unknown.length}건은 통과로 세지 않았습니다: ` +
        `${unknown.map((step) => step.title).join(" · ")}.`,
    );
  }

  return {
    steps,
    done,
    total: steps.length,
    nextStep,
    irreversibleStarted,
    waitingOnPeople,
    detail: parts.join(" "),
  };
}
