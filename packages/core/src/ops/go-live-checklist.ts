/**
 * 최종 Go-Live 체크리스트. (TASK-4501, Sprint 45 — CTO 정책 4501-⑤)
 *
 * 런북(4401-⑤)은 **하는 순서**를 적습니다. 이 체크리스트는 그 뒤의 마지막
 * 질문 하나에 답합니다 — **이제 운영이라고 말해도 되는가.**
 *
 * ## 이 판정이 지켜야 하는 것
 *
 * 1. **검증이 성공하지 않았으면 나머지가 다 초록이어도 "준비 완료"가 아닙니다.**
 *    그건 준비가 끝난 상태가 아니라 **아직 시작도 안 한 상태**입니다. 항목
 *    개수를 세어 "8개 중 7개 완료"라고 말하면, 빠진 하나가 전부인 상황에서
 *    숫자가 진행을 흉내 냅니다.
 * 2. **여기서 새로 판정하지 않습니다.** 각 항목의 상태는 이미 있는 판정을
 *    인용합니다(4301-④·4401-⑤와 같은 규칙). 같은 사실에 두 개의 답이
 *    생기면 사람은 둘 다 안 믿습니다.
 * 3. **읽지 못한 항목은 통과가 아닙니다.** `unknown`은 `unmet`과 같은 무게로
 *    Go-Live를 막습니다 — 모르는 것을 통과로 처리하지 않습니다.
 * 4. **선언은 사람이 합니다.** 이 함수는 "선언해도 되는가"까지만 답하고
 *    선언하지 않습니다. 마지막 문장을 시스템이 쓰게 두면, 나중에 "누가
 *    운영이라고 했나"에 답할 사람이 없습니다.
 */

export type GoLiveState = "met" | "unmet" | "unknown";

export interface GoLiveItem {
  id: string;
  title: string;
  /** 왜 이것이 Go-Live 조건인가 */
  why: string;
  /** 무엇을 보면 충족인가 */
  evidence: string;
  /** 어느 판정에서 상태를 인용하는가 */
  source: string;
}

/**
 * Go-Live 조건 (CTO 정책 4501-⑤).
 *
 * 맨 앞이 검증 성공인 이유는, 그것이 다른 모든 항목의 **전제**이기
 * 때문입니다. 검증을 돌리지 않은 채로 얻은 초록은 전부 스텁의 초록입니다.
 */
export const GO_LIVE_ITEMS: GoLiveItem[] = [
  {
    id: "validation",
    title: "실 Production Validation 성공",
    why:
      "실 호출 없이 얻은 초록은 전부 스텁의 초록입니다. 이것이 없으면 " +
      "아래 항목이 모두 충족이어도 우리가 확인한 것은 우리 스텁뿐입니다.",
    evidence:
      "POST /ops/validation-run/execute가 성공으로 끝난 기록이 있고, 그 " +
      "실행에서 스텁 응답이 0건입니다.",
    source: "POST /ops/validation-run/execute",
  },
  {
    id: "runbook",
    title: "운영 활성화 런북 전 단계 완료",
    why:
      "순서를 건너뛰고 도달한 상태는, 문제가 생겼을 때 어디로 되돌려야 " +
      "하는지 모르는 상태입니다.",
    evidence: "GET /ops/runbook의 모든 단계가 done입니다.",
    source: "GET /ops/runbook",
  },
  {
    id: "cutover",
    title: "실 Provider 전환 확인",
    why: "성공 기록이 있어도 상대가 스텁이었으면 전환된 것이 아닙니다.",
    evidence: "GET /ops/cutover의 모든 대상이 verified이고 스텁 응답이 0건입니다.",
    source: "GET /ops/cutover",
  },
  {
    id: "hosts",
    title: "운영 호스트 목록 확정",
    why:
      "목록이 비어 있거나 관측이 잘려 있으면, 검증 대상 보호는 위험한 " +
      "주소를 막는 것이 아니라 그냥 통과시키고 있는 것입니다.",
    evidence:
      "GET /ops/hosts에서 목록에 없는 호스트가 0개이고 관측이 잘리지 않았습니다.",
    source: "GET /ops/hosts",
  },
  {
    id: "alerts",
    title: "경보 경로 도달 확인",
    why:
      "장애를 감지해도 아무도 못 받으면 감지하지 않은 것과 같습니다. " +
      "채널이 설정돼 있다는 것과 실제로 도달한다는 것은 다른 사실입니다.",
    evidence: "최근 알림 전송 기록에 성공이 있고, 긴급 경로가 구성돼 있습니다.",
    source: "GET /ops/notifications",
  },
  {
    id: "attribution",
    title: "비용 귀속률 목표 달성",
    why:
      "누구의 비용인지 모르는 실행이 많으면 예산은 있는데 그 예산이 누구 " +
      "것인지 모르는 상태가 됩니다.",
    evidence: "최근 실행의 프로젝트 귀속률이 목표 이상이고 표본이 충분합니다.",
    source: "GET /ops/cost/attribution",
  },
  {
    id: "drill",
    title: "되돌리는 절차 확인",
    why: "되돌릴 수 없다면 그건 검증이 아니라 그냥 전환입니다.",
    evidence: "최근 복구 리허설이 성공했고 그 절차가 이번 전환에 적용됩니다.",
    source: "GET /ops/drills",
  },
  {
    id: "neglect",
    title: "방치된 항목 정리",
    why:
      "오래 안 본 실패를 안고 운영에 들어가면, 그중 하나가 첫 장애가 " +
      "됩니다. 무시는 해결이 아니지만, 이유·담당·재검토일이 적힌 무시는 " +
      "적어도 사라지지 않습니다.",
    evidence:
      "GET /ops/neglect에 남은 항목이 없거나, 남은 것 전부에 이유·담당·재검토일이 있습니다.",
    source: "GET /ops/neglect",
  },
];

export interface GoLiveItemState extends GoLiveItem {
  state: GoLiveState;
  detail: string;
}

/**
 * - `not-started` — 검증이 성공하지 않았다. **나머지를 세지 않는다.**
 * - `incomplete` — 검증은 성공했지만 남은 항목이 있다.
 * - `declarable` — 전부 충족. 그래도 선언은 사람이 한다.
 */
export type GoLiveVerdict = "not-started" | "incomplete" | "declarable";

export interface GoLiveReport {
  verdict: GoLiveVerdict;
  items: GoLiveItemState[];
  met: number;
  total: number;
  /** 아직 안 된 항목의 제목 (unknown 포함) */
  blocking: string[];
  detail: string;
}

/**
 * Go-Live 체크리스트의 지금 상태 (순수 함수).
 *
 * `states`는 이미 있는 판정에서 가져온 값입니다. 못 가져온 항목은 `unknown`
 * 이며 **막습니다.**
 */
export function buildGoLiveChecklist(input: {
  states: Record<string, { state: GoLiveState; detail: string }>;
}): GoLiveReport {
  const items: GoLiveItemState[] = GO_LIVE_ITEMS.map((item) => {
    const found = input.states[item.id];
    return {
      ...item,
      state: found?.state ?? "unknown",
      detail:
        found?.detail ??
        "이 항목의 상태를 읽지 못했습니다 — 됐다는 뜻이 아닙니다.",
    };
  });

  const met = items.filter((item) => item.state === "met").length;
  const blocking = items
    .filter((item) => item.state !== "met")
    .map((item) => item.title);

  const validation = items.find((item) => item.id === "validation")!;

  if (validation.state !== "met") {
    // **여기서 met 개수를 앞세우지 않습니다.** "8개 중 7개"라고 말하는 순간
    // 빠진 하나가 전부인 상황에서 숫자가 진행을 흉내 냅니다.
    return {
      verdict: "not-started",
      items,
      met,
      total: items.length,
      blocking,
      detail:
        "실 Production Validation이 아직 성공하지 않았습니다. " +
        `${validation.detail} ` +
        "이 상태에서 나머지 항목이 초록인 것은 준비가 끝났다는 뜻이 아니라 " +
        "아직 시작도 안 했다는 뜻입니다 — 지금까지의 초록은 전부 스텁을 상대로 " +
        "얻은 것입니다.",
    };
  }

  if (blocking.length > 0) {
    const unknown = items.filter((item) => item.state === "unknown");
    const parts = [
      `Go-Live 조건 ${met}/${items.length} 충족. 남은 항목: ${blocking.join(" · ")}.`,
    ];
    if (unknown.length > 0) {
      parts.push(
        `이 중 ${unknown.length}건은 상태를 읽지 못한 것이며 통과로 세지 않았습니다.`,
      );
    }
    return {
      verdict: "incomplete",
      items,
      met,
      total: items.length,
      blocking,
      detail: parts.join(" "),
    };
  }

  return {
    verdict: "declarable",
    items,
    met,
    total: items.length,
    blocking: [],
    detail:
      `Go-Live 조건 ${met}/${items.length}이 모두 증거와 함께 충족됐습니다. ` +
      "선언은 사람이 합니다 — 시스템이 마지막 문장을 쓰면 나중에 누가 " +
      "운영이라고 했는지 답할 사람이 없습니다.",
  };
}
