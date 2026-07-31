/**
 * Production Validation Sprint 준비. (TASK-4001, Sprint 40 — CTO 정책 4001-⑥)
 *
 * ## 이 파일이 하지 않는 일: "준비 완료"라고 선언하는 것
 *
 * 정책은 "준비를 완료한다"입니다. 그런데 우리가 세 스프린트 연속 보고해 온
 * 사실이 있습니다 — **실 Provider 검증에 필요한 것 중 우리가 만들 수 있는
 * 것은 하나도 남아 있지 않습니다.** 남은 것은 자격 증명, 나가는 길, 검증용
 * 환경이고 셋 다 **사람이 주는 것**입니다.
 *
 * 그래서 여기서 "준비 완료"를 자동으로 계산해 초록으로 칠하면, 그 초록은
 * 우리가 한 일이 아니라 **우리가 못 하는 일을 가린 것**이 됩니다. 지금까지
 * 이 코드베이스에서 가장 여러 번 고쳐 온 결함이 정확히 그 모양이었습니다
 * (모르는 것을 통과로 처리하기, 스텁 성공을 실연결로 세기, 느슨해진 임계값을
 * 상태 개선으로 읽기).
 *
 * 대신 이 파일은 **검증 스프린트를 시작하기 위한 단계 목록**을 만들고, 각
 * 단계마다 세 가지를 분명히 합니다:
 *
 * 1. **누가 하는가** — 시스템이 할 수 있는 일인가, 사람이 줘야 하는 일인가.
 * 2. **무엇이 증거인가** — "됐다"를 무엇으로 확인하는가. 증거를 미리 적어
 *    두지 않으면, 나중에 "아마 됐을 것"이 증거 자리에 들어옵니다.
 * 3. **못 하고 있는가, 안 하고 있는가** — 앞 단계가 막혀서 못 하는 것
 *    (`blocked`)과 아직 안 한 것(`pending`)은 다릅니다. 둘을 같은 색으로
 *    칠하면 "우리가 게을러서 안 한 것"처럼 보이고, 진짜 병목이 가려집니다.
 *
 * 그리고 결론은 셋 중 하나입니다: `ready`(정말로 시작할 수 있다),
 * `blocked`(사람이 줄 것이 남았다), `not-ready`(우리 쪽 일이 남았다).
 * **`blocked`을 `ready`로 올리는 경로는 없습니다.**
 */

/** 이 단계를 누가 끝낼 수 있는가 */
export type StepOwner =
  /** 코드·배포로 끝낼 수 있다 — 우리 책임이다 */
  | "system"
  /** 자격 증명·네트워크·환경처럼 **밖에서 와야** 하는 것 */
  | "operator";

export type StepStatus =
  /** 증거가 있다 */
  | "done"
  /** 앞 단계가 막혀 **할 수가 없다** */
  | "blocked"
  /** 할 수 있는데 아직 안 했다 */
  | "pending"
  /** 확인하지 못했다 — **통과가 아니다** */
  | "unknown";

export interface ValidationStep {
  id: string;
  title: string;
  owner: StepOwner;
  /** 왜 이 단계가 필요한가 */
  why: string;
  /** 무엇을 보면 "됐다"인가 */
  evidence: string;
  /** 이 단계가 성립하려면 먼저 끝나야 하는 단계 */
  dependsOn: string[];
}

/**
 * 검증 스프린트 단계 (CTO 정책 4001-⑥).
 *
 * 순서는 **막히는 순서**입니다: 자격 증명이 없으면 스모크를 못 돌리고,
 * 스모크가 없으면 전환이 검증되지 않고, 전환이 검증되지 않으면 검증
 * 스프린트에서 재는 숫자가 스텁의 숫자입니다.
 */
export const VALIDATION_STEPS: ValidationStep[] = [
  {
    id: "credentials",
    title: "실 Provider 자격 증명 주입",
    owner: "operator",
    why: "실 호출 없이 재는 모든 숫자는 스텁의 숫자입니다.",
    evidence: "GET /ops/activation의 credentials 조건이 충족으로 바뀝니다.",
    dependsOn: [],
  },
  {
    id: "egress",
    title: "공식 주소로 나가는 길 열기",
    owner: "operator",
    why:
      "이 환경의 프록시는 api.openai.com을 막고 있습니다(HTTP 403). " +
      "키가 틀린 것과 길이 막힌 것은 다른 문제이고, 길이 막혀 있으면 " +
      "올바른 키를 넣어도 실패합니다.",
    evidence: "GET /ops/cutover의 도달 점검이 unreachable에서 벗어납니다.",
    dependsOn: [],
  },
  {
    id: "staging",
    title: "검증용 환경 확보",
    owner: "operator",
    why:
      "실 호출은 돈이 나가고 외부에 흔적을 남깁니다. 개발자 노트북에서 " +
      "운영 키로 스모크를 돌리는 것은 검증이 아니라 사고입니다.",
    evidence: "검증 대상 주소가 정해지고, 그 환경에 배포가 한 번 끝납니다.",
    dependsOn: [],
  },
  {
    id: "migrations",
    title: "스키마 적용 완료",
    owner: "system",
    why: "미적용 마이그레이션이 남은 채로 재는 숫자는 다음 배포에 바뀝니다.",
    evidence: "기동 진단의 '마이그레이션 적용'이 정상입니다.",
    dependsOn: ["staging"],
  },
  {
    id: "diagnostics",
    title: "기동 진단 실패 0건",
    owner: "system",
    why:
      "환경변수 하나가 빠진 채 검증을 시작하면, 검증 결과가 그 설정의 " +
      "결과인지 제품의 결과인지 나중에 가릴 수 없습니다.",
    evidence: "GET /ops/diagnostics의 실패가 0건입니다 (모르는 항목은 통과가 아닙니다).",
    dependsOn: ["staging"],
  },
  {
    id: "urgent-channel",
    title: "긴급 알림 경로 구성",
    owner: "operator",
    why:
      "검증 스프린트는 실패를 만들려고 하는 기간입니다. 그 실패가 " +
      "일반 채널에 묻히면 검증하는 사람이 가장 늦게 압니다.",
    evidence: "ALERT_URGENT_* 중 하나가 설정되고, 시험 발송이 그 경로로 나갑니다.",
    dependsOn: [],
  },
  {
    id: "smoke",
    title: "실 호출 스모크 3종 통과",
    owner: "system",
    why:
      "LLM·OCR·저장소를 실제로 한 번씩 불러 봐야 계약이 맞는지 압니다. " +
      "스텁 통과는 계약 확인이지 연결 확인이 아닙니다.",
    evidence: "POST /ops/smoke가 세 대상 모두 passed이고, stubbed가 0건입니다.",
    dependsOn: ["credentials", "egress", "staging"],
  },
  {
    id: "cutover",
    title: "실 Provider 전환 검증",
    owner: "system",
    why: "성공 기록이 있어도 상대가 스텁이었으면 전환된 것이 아닙니다.",
    evidence: "GET /ops/cutover의 모든 대상이 verified이고 not-production이 0건입니다.",
    dependsOn: ["smoke"],
  },
  {
    id: "baseline",
    title: "KPI 기준선 확보",
    owner: "system",
    why:
      "검증 스프린트에서 알고 싶은 것은 '좋아졌는가'인데, 그건 두 번 재야 " +
      "압니다. 시작 시점의 점이 없으면 끝나고 나서 비교할 대상이 없습니다.",
    evidence: "KPI 스냅샷이 2점 이상 쌓여 추세를 낼 수 있습니다.",
    dependsOn: [],
  },
  {
    id: "rollback",
    title: "되돌리는 절차 확인",
    owner: "operator",
    why:
      "실 Provider로 바꾼 뒤 문제가 생겼을 때 되돌릴 수 없다면, 그건 " +
      "검증이 아니라 그냥 전환입니다.",
    evidence: "최근 복구 리허설 기록이 있고, 그 절차가 이번 전환에도 적용됩니다.",
    dependsOn: [],
  },
];

export interface ValidationPlanInput {
  /** 활성화 조건 (credentials/network/cutover) — 못 봤으면 null */
  activation: { id: string; met: boolean }[] | null;
  /** 전환 검증 — 못 봤으면 null */
  cutover: { verified: number; total: number; notProduction: number } | null;
  /** 스모크 최근 결과 — 돌린 적 없으면 null */
  smoke: { passed: number; total: number; stubbed: number } | null;
  /** 기동 진단 — 못 돌렸으면 null */
  diagnostics: { fail: number; unknown: number } | null;
  /** 미적용 마이그레이션 — 못 읽었으면 null */
  pendingMigrations: number | null;
  /** 긴급 경로가 설정돼 있는가 */
  urgentChannelConfigured: boolean;
  /**
   * 검증 대상 판정 (TASK-4101, 정책 4101-① 배선).
   *
   * 예전에는 주소 문자열만 받았고, **비어 있지 않으면 통과**로 봤습니다.
   * 그러면 운영 주소를 적어 둔 상태에서도 "검증용 환경 확보 완료"가 되고,
   * 그 뒤 단계까지 줄줄이 열립니다 — 같은 값을 두 곳에서 서로 다르게
   * 판정하던 것입니다(라이브 검증에서 드러남). 이제 **보호 판정을 그대로
   * 받습니다.**
   */
  stagingTarget: { url: string | null; usable: boolean; detail: string } | null;
  /** 쌓인 KPI 스냅샷 수 */
  kpiSnapshots: number;
  /** 최근 복구 리허설 시각 (ms) — 없으면 null */
  lastDrillAt: number | null;
  now: number;
}

export interface ValidationStepState extends ValidationStep {
  status: StepStatus;
  detail: string;
  /** 막혔다면 무엇 때문에 */
  blockedBy: string[];
}

export type ValidationReadiness = "ready" | "blocked" | "not-ready";

export interface ValidationPlanReport {
  steps: ValidationStepState[];
  readiness: ValidationReadiness;
  done: number;
  /** 사람이 줘야 끝나는 미완 단계 */
  waitingOnPeople: ValidationStepState[];
  /** 우리 쪽에 남은 미완 단계 */
  waitingOnUs: ValidationStepState[];
  /** 확인하지 못한 단계 — 통과로 세지 않았다 */
  unknown: ValidationStepState[];
  /** 앞 단계가 막혀 시작할 수 없는 단계 — 우리 몫으로도 사람 몫으로도 세지 않는다 */
  blocked: ValidationStepState[];
  detail: string;
}

/** 리허설이 이보다 오래됐으면 "최근"이 아니다 */
export const DRILL_FRESH_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * 검증 스프린트 준비 상태를 판정한다 (순수 함수, CTO 정책 4001-⑥).
 *
 * 두 규칙만 지키면 이 판정은 거짓말하지 않습니다:
 *
 * - **못 본 것은 `unknown`** 이고, `unknown`이 하나라도 있으면 `ready`가
 *   아닙니다.
 * - **의존 단계가 끝나지 않았으면 `blocked`** 이며, 그 단계는 우리가
 *   부지런해져서 해결되는 것이 아닙니다.
 */
export function judgeValidationPlan(input: ValidationPlanInput): ValidationPlanReport {
  const evaluated = new Map<string, ValidationStepState>();

  for (const step of VALIDATION_STEPS) {
    const own = evaluateStep(step, input);

    // 앞 단계가 끝나지 않았으면 이 단계는 "안 한 것"이 아니라 "못 하는 것"이다
    const blockedBy = step.dependsOn.filter((id) => {
      const parent = evaluated.get(id);
      return parent === undefined || parent.status !== "done";
    });

    if (blockedBy.length > 0) {
      // **증거가 있어 보여도 `done`으로 올리지 않습니다** (라이브 검증에서
      // 고침). `migrations`·`diagnostics`는 지금 도는 환경을 보고 판정하는데,
      // 검증 대상 환경이 아직 정해지지 않았다면 그 증거는 **다른 환경의
      // 것**입니다. 그것을 통과로 세면 "스테이징에서 확인했다"가 아니라
      // "개발자 노트북에서 확인했다"가 준비 완료의 근거가 됩니다 — 스텁
      // 성공을 실연결로 세지 않기로 한 것과 같은 판단입니다.
      evaluated.set(step.id, {
        ...step,
        status: "blocked",
        blockedBy,
        detail:
          `앞 단계가 끝나지 않아 시작할 수 없습니다 (${blockedBy
            .map((id) => titleOf(id))
            .join(" · ")}). ` +
          (own.status === "done"
            ? `지금 환경에서는 "${own.detail}" 이지만, 그 증거는 검증 대상 ` +
              "환경의 것이 아닙니다."
            : own.detail),
      });
      continue;
    }

    evaluated.set(step.id, { ...step, ...own, blockedBy: [] });
  }

  const steps = [...evaluated.values()];
  const unfinished = steps.filter((step) => step.status !== "done");
  const unknown = steps.filter((step) => step.status === "unknown");
  const blocked = unfinished.filter((step) => step.status === "blocked");
  // **막힌 단계를 "우리 쪽에 남은 일"로 세지 않습니다** (라이브 검증에서
  // 고침). 스모크는 우리가 돌리지만 자격 증명이 없으면 못 돌립니다 — 그것을
  // 우리 몫으로 적으면 "우리가 게을러서 안 했다"로 읽히고, 진짜 병목인
  // 사람 쪽 단계가 그만큼 작아 보입니다.
  const waitingOnPeople = unfinished.filter(
    (step) => step.owner === "operator" && step.status !== "blocked",
  );
  const waitingOnUs = unfinished.filter(
    (step) => step.owner === "system" && step.status !== "blocked",
  );

  // `blocked`을 `ready`로 올리는 경로는 없다 — 사람이 줄 것이 남아 있으면
  // 우리가 아무리 부지런해도 검증 스프린트는 시작되지 않는다
  const readiness: ValidationReadiness =
    unfinished.length === 0
      ? "ready"
      : waitingOnPeople.length > 0
        ? "blocked"
        : "not-ready";

  const parts: string[] = [
    `검증 스프린트 준비 ${steps.length - unfinished.length}/${steps.length} 단계 완료.`,
  ];
  if (readiness === "ready") {
    parts.push("모든 단계에 증거가 있습니다 — 검증 스프린트를 시작할 수 있습니다.");
  }
  if (waitingOnPeople.length > 0) {
    parts.push(
      `사람이 줘야 끝나는 단계 ${waitingOnPeople.length}건: ` +
        waitingOnPeople.map((step) => step.title).join(" · ") +
        ". 이 단계들은 코드로 해결되지 않습니다.",
    );
  }
  if (waitingOnUs.length > 0) {
    parts.push(
      `지금 우리가 할 수 있는 단계 ${waitingOnUs.length}건: ` +
        waitingOnUs.map((step) => step.title).join(" · ") +
        ".",
    );
  }
  if (blocked.length > 0) {
    parts.push(
      `앞 단계가 막혀 시작할 수 없는 단계 ${blocked.length}건: ` +
        blocked.map((step) => step.title).join(" · ") +
        ". 이 단계들은 우리가 부지런해져서 풀리지 않습니다.",
    );
  }
  if (unknown.length > 0) {
    parts.push(
      `확인하지 못한 단계 ${unknown.length}건 — 통과로 세지 않았습니다.`,
    );
  }

  return {
    steps,
    readiness,
    done: steps.length - unfinished.length,
    waitingOnPeople,
    waitingOnUs,
    unknown,
    blocked,
    detail: parts.join(" "),
  };
}

function titleOf(id: string): string {
  return VALIDATION_STEPS.find((step) => step.id === id)?.title ?? id;
}

/** 단계 하나를 관측 사실로 판정한다 — 의존 관계는 보지 않는다 */
function evaluateStep(
  step: ValidationStep,
  input: ValidationPlanInput,
): { status: StepStatus; detail: string } {
  switch (step.id) {
    case "credentials": {
      if (input.activation === null) {
        return { status: "unknown", detail: "활성화 조건을 읽지 못했습니다." };
      }
      const row = input.activation.find((item) => item.id === "credentials");
      if (row === undefined) {
        return { status: "unknown", detail: "credentials 조건이 보고에 없습니다." };
      }
      return row.met
        ? { status: "done", detail: "실 자격 증명이 설정돼 있습니다." }
        : {
            status: "pending",
            detail: "실 자격 증명이 아직 없습니다 — 지금 재는 값은 스텁의 값입니다.",
          };
    }
    case "egress": {
      if (input.activation === null) {
        return { status: "unknown", detail: "활성화 조건을 읽지 못했습니다." };
      }
      const row = input.activation.find((item) => item.id === "network");
      if (row === undefined) {
        return { status: "unknown", detail: "network 조건이 보고에 없습니다." };
      }
      return row.met
        ? { status: "done", detail: "공식 주소에 닿습니다." }
        : {
            status: "pending",
            detail: "공식 주소에 닿지 못합니다 — 자격 증명 이전의 문제입니다.",
          };
    }
    case "staging": {
      if (input.stagingTarget === null) {
        return {
          status: "unknown",
          detail: "검증 대상 판정을 읽지 못했습니다 — 정해졌다는 뜻이 아닙니다.",
        };
      }
      if (input.stagingTarget.url === null) {
        return {
          status: "pending",
          detail: "검증 대상 환경이 아직 정해지지 않았습니다.",
        };
      }
      // **주소가 있다고 통과가 아니다** — 운영을 가리키거나, 자기 자신을
      // 가리키거나, 확인이 없으면 그것은 검증용 환경이 아니다
      return input.stagingTarget.usable
        ? { status: "done", detail: input.stagingTarget.detail }
        : { status: "pending", detail: input.stagingTarget.detail };
    }
    case "migrations": {
      if (input.pendingMigrations === null) {
        return {
          status: "unknown",
          detail: "적용 상태를 읽지 못했습니다 — 0건이라는 뜻이 아닙니다.",
        };
      }
      return input.pendingMigrations === 0
        ? { status: "done", detail: "미적용 마이그레이션이 없습니다." }
        : {
            status: "pending",
            detail: `미적용 ${input.pendingMigrations}건이 남아 있습니다.`,
          };
    }
    case "diagnostics": {
      if (input.diagnostics === null) {
        return { status: "unknown", detail: "진단을 아직 돌리지 않았습니다." };
      }
      if (input.diagnostics.fail > 0) {
        return {
          status: "pending",
          detail: `진단 실패 ${input.diagnostics.fail}건이 남아 있습니다.`,
        };
      }
      if (input.diagnostics.unknown > 0) {
        // 모르는 것을 통과로 처리하지 않는다
        return {
          status: "unknown",
          detail:
            `실패는 없지만 확인하지 못한 항목이 ${input.diagnostics.unknown}건 ` +
            "있습니다 — 그것은 정상이 아니라 모르는 것입니다.",
        };
      }
      return { status: "done", detail: "진단 실패·미확인 항목이 없습니다." };
    }
    case "urgent-channel": {
      return input.urgentChannelConfigured
        ? { status: "done", detail: "긴급 경로가 설정돼 있습니다." }
        : {
            status: "pending",
            detail:
              "긴급 경로가 없어 급한 알림이 일반 채널로 나갑니다 — " +
              "실패를 만들어 보는 기간에는 그 지연이 그대로 손해가 됩니다.",
          };
    }
    case "smoke": {
      if (input.smoke === null) {
        return { status: "pending", detail: "실 호출 스모크를 아직 돌리지 않았습니다." };
      }
      if (input.smoke.stubbed > 0) {
        // 스텁 통과를 실연결로 세지 않는다 (정책 3701-②의 연장)
        return {
          status: "pending",
          detail:
            `스텁 상대 ${input.smoke.stubbed}건이 포함돼 있습니다 — ` +
            "스텁 통과는 계약 확인이지 연결 확인이 아닙니다.",
        };
      }
      return input.smoke.passed === input.smoke.total && input.smoke.total > 0
        ? { status: "done", detail: `실 호출 ${input.smoke.total}종이 모두 통과했습니다.` }
        : {
            status: "pending",
            detail: `통과 ${input.smoke.passed}/${input.smoke.total}.`,
          };
    }
    case "cutover": {
      if (input.cutover === null) {
        return { status: "unknown", detail: "전환 검증 결과를 읽지 못했습니다." };
      }
      if (input.cutover.notProduction > 0) {
        return {
          status: "pending",
          detail:
            `운영의 상대가 아닌 대상 ${input.cutover.notProduction}건이 있습니다 — ` +
            "돌고는 있지만 전환된 것이 아닙니다.",
        };
      }
      return input.cutover.verified === input.cutover.total && input.cutover.total > 0
        ? { status: "done", detail: `대상 ${input.cutover.total}종이 모두 검증됐습니다.` }
        : {
            status: "pending",
            detail: `검증 ${input.cutover.verified}/${input.cutover.total}.`,
          };
    }
    case "baseline": {
      return input.kpiSnapshots >= 2
        ? {
            status: "done",
            detail: `스냅샷 ${input.kpiSnapshots}점 — 추세를 낼 수 있습니다.`,
          }
        : {
            status: "pending",
            detail:
              `스냅샷이 ${input.kpiSnapshots}점뿐입니다 — 한 점으로는 ` +
              "검증 전후를 비교할 수 없습니다.",
          };
    }
    case "rollback": {
      if (input.lastDrillAt === null) {
        return { status: "pending", detail: "복구 리허설 기록이 없습니다." };
      }
      const age = input.now - input.lastDrillAt;
      return age <= DRILL_FRESH_MS
        ? {
            status: "done",
            detail: `${Math.round(age / 86_400_000)}일 전 리허설 기록이 있습니다.`,
          }
        : {
            status: "pending",
            detail:
              `마지막 리허설이 ${Math.round(age / 86_400_000)}일 전입니다 — ` +
              "그때 통했다는 것이 지금 통한다는 뜻은 아닙니다.",
          };
    }
    default:
      return { status: "unknown", detail: "판정 규칙이 없는 단계입니다." };
  }
}
