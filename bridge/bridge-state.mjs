/**
 * CTO Bridge — 상태 계층 (State Layer)
 *
 * ChatGPT(총괄) ↔ Claude Code(실행자) 사이에서 **작업의 상태만** 다룬다.
 * 파일도 네트워크도 만지지 않는 순수 판정이다 — 그래야 어느 세션에서
 * 불러도 같은 답이 나온다.
 *
 * ## 왜 계층을 나누는가 (CTO 지시 10)
 *
 * 지금은 ChatGPT가 Claude Code를 직접 호출할 수 있는 연결이 **없다.**
 * 있다고 가정하지 않는다. 그래서 세 계층을 분리한다:
 *
 *   통신 계층 (bridge-io.mjs)    파일로 주고받는다 — 나중에 API로 바뀔 수 있다
 *   상태 계층 (이 파일)           작업이 어느 단계인지 판정한다
 *   실행 계층 (Claude Code)       실제로 코드를 고치고 테스트한다
 *
 * 통신 방식이 바뀌어도 상태 판정은 그대로 쓴다.
 */

/** 작업 상태 — 이 순서로만 진행한다 */
export const TASK_STATES = [
  "REQUESTED", // ChatGPT가 지시함. 아직 시작 안 함
  "IN_PROGRESS", // Claude가 구현 중
  "TESTING", // 구현은 끝났고 검증 중
  "READY_FOR_REVIEW", // 브라우저에서 사람이 볼 수 있는 상태
  "COMPLETED", // 사람이 확인하고 승인함
  // 사람의 결정이 **반드시** 필요해서 멈춘 상태. 진행 단계가 아니라
  // 옆으로 빠지는 자리다. 무엇을 정해야 하는지 적어야만 들어올 수 있다.
  "BLOCKED",
];

/** 되돌아갈 수 있는 전이 — 오류가 나면 앞 단계로 돌아간다 */
const ALLOWED = {
  REQUESTED: ["IN_PROGRESS"],
  // IN_PROGRESS → REQUESTED 는 **복구 통로**다. 실행 중이던 프로세스가
  // 죽으면(서버 재시작·PC 재부팅) 작업은 영원히 IN_PROGRESS에 갇힌다.
  // 다시 대기열로 돌려놓을 수 있어야 한다. 앞으로 건너뛰는 것과 다르다 —
  // 뒤로 가는 것은 검증을 건너뛰지 않는다.
  IN_PROGRESS: ["TESTING", "IN_PROGRESS", "REQUESTED", "BLOCKED"],
  // 검증에서 실패하면 구현으로 되돌아간다. 이것이 "자동 반복"의 통로다.
  TESTING: ["READY_FOR_REVIEW", "IN_PROGRESS", "BLOCKED"],
  // 사람이 수정을 요청하면 다시 구현으로 간다.
  READY_FOR_REVIEW: ["COMPLETED", "IN_PROGRESS"],
  COMPLETED: [],
  // 사람이 결정을 내려 주면 다시 돈다. 결정 없이는 스스로 나오지 못한다.
  BLOCKED: ["IN_PROGRESS", "REQUESTED"],
};

/**
 * 상태를 옮겨도 되는지 판정한다.
 *
 * **건너뛰기를 막는 것이 목적이다.** 코드를 썼다고 바로
 * READY_FOR_REVIEW로 가면, 검증하지 않은 것을 사람에게 보여 주게 된다
 * (CTO 지시 3 — "단순히 코드가 작성되었다는 이유로 완료 처리하지 않는다").
 */
export function canTransition(from, to) {
  if (!TASK_STATES.includes(from)) {
    return { ok: false, reason: `알 수 없는 현재 상태입니다: ${from}` };
  }
  if (!TASK_STATES.includes(to)) {
    return { ok: false, reason: `알 수 없는 목표 상태입니다: ${to}` };
  }
  if (!ALLOWED[from].includes(to)) {
    return {
      ok: false,
      reason: `${from} → ${to} 로는 갈 수 없습니다. 가능한 것: ${
        ALLOWED[from].join(", ") || "(없음 — 종료 상태)"
      }`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * READY_FOR_REVIEW로 올릴 자격이 있는지 본다.
 *
 * **초록일 수 있는 게이트는 게이트가 아니다.** 아래를 모두 채우지 못하면
 * 사람에게 보여 주지 않는다.
 */
/**
 * 검사 하나가 실패했는지 본다.
 *
 * 값은 두 가지 형태를 받는다.
 *
 * | 형태 | 판정 |
 * | --- | --- |
 * | `{ ok: false, detail: "…" }` | **적힌 대로** 믿는다 — 추측하지 않는다 |
 * | `"130개 통과, 0건 실패"` | 글자를 읽어 짐작한다 |
 *
 * 글자를 읽는 쪽은 **틀릴 수 있다.** "0건 실패"·"오류 없음"처럼 **없다고
 * 적은 것**을 실패로 읽으면, 통과해야 할 것을 막는다 — 그것도 결함이다
 * (실측 2026-08-09: "12장 생성 · 실패 0", "lint 0건(새 오류 없음)"이
 * 실패로 잡혔다). 그래서 명시적인 `ok`를 받을 수 있게 열어 두고, 문자열은
 * "없다고 적은 표현"을 먼저 지운 뒤에 본다.
 */
export function checkFailed(value) {
  if (value && typeof value === "object") {
    return value.ok === false;
  }
  if (typeof value !== "string") return false;
  const withoutZeros = value
    // "실패 0" · "failures: 0" · "0 errors"
    .replace(/(실패|오류|에러|fail(?:ed|ures?)?|errors?)\s*[:=]?\s*0(?:개|건|장)?/gi, "")
    .replace(/0\s*(개|건|장)?\s*(실패|오류|에러|fail(?:ed|ures?)?|errors?)/gi, "")
    // "오류 없음" · "실패 없음" · "no errors"
    .replace(/(실패|오류|에러)\s*(는|은|가|이)?\s*(없음|없다|없습니다|아님)/g, "")
    .replace(/no\s+(errors?|failures?)/gi, "")
    // "실행 안 함" — 돌리지 않은 것은 실패가 아니다. 다만 빠진 기록이므로
    // 항목 누락 검사(missing)가 따로 잡는다.
    .replace(/실행\s*안\s*함/g, "");
  return /실패|오류|에러|fail|error/i.test(withoutZeros);
}

/** 기록이 있는지 — 문자열이든 `{ok, detail}` 이든 내용이 있어야 한다 */
function recorded(value) {
  if (value && typeof value === "object") return typeof value.ok === "boolean";
  return Boolean(value);
}

/**
 * 사람에게 보여 주기 전에 **반드시 기록돼 있어야 할 검사**.
 *
 * 프로젝트마다 다르다 — 빌드도 타입체크도 없는 저장소가 있다. 그래서
 * 등록 정보에서 온다. 주지 않으면 이 값이다(기존 프로젝트가 쓰던 그대로).
 */
export const DEFAULT_REQUIRED_CHECKS = ["build", "typecheck", "lint", "tests"];

export function readyForReview(result, requiredChecks = DEFAULT_REQUIRED_CHECKS) {
  const required = Array.isArray(requiredChecks) && requiredChecks.length > 0 ? requiredChecks : DEFAULT_REQUIRED_CHECKS;
  const missing = [];
  for (const name of required) {
    if (!recorded(result?.testResults?.[name])) missing.push(`${name} 결과`);
  }
  if (!result?.browserUrl) missing.push("브라우저 검증 주소");
  if (!Array.isArray(result?.userChecks) || result.userChecks.length === 0) {
    missing.push("사용자가 확인할 항목");
  }
  if (!Array.isArray(result?.changedFiles)) missing.push("변경 파일 목록");

  const failed = [];
  for (const [name, value] of Object.entries(result?.testResults ?? {})) {
    if (checkFailed(value)) failed.push(name);
  }

  return {
    ok: missing.length === 0 && failed.length === 0,
    missing,
    failed,
    reason:
      missing.length > 0
        ? `기록이 빠졌습니다: ${missing.join(" · ")}`
        : failed.length > 0
          ? `실패한 검사가 있습니다: ${failed.join(" · ")}`
          : null,
  };
}

/**
 * BLOCKED로 갈 자격이 있는지 본다.
 *
 * **막히는 것은 쉬운 선택지가 되면 안 된다.** 무인 실행의 목적은 사람 없이
 * 끝까지 가는 것이다. 그래서 "무엇을 정해 주면 되는지"를 적지 않으면
 * BLOCKED로 들어올 수 없다. 이유 없이 멈춘 작업은 아무도 풀 수 없다.
 *
 * 각 항목에는 **질문**과 **왜 스스로 정할 수 없는지**가 있어야 한다.
 * 스스로 정할 수 있는 것을 사람에게 미루는 것도 실패다.
 */
export function blockedGate(result) {
  const items = result?.decisionNeeded;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: "사람이 무엇을 정해야 하는지 적지 않았습니다." };
  }
  const bad = [];
  items.forEach((item, index) => {
    if (!item?.question) bad.push(`${index + 1}번: 질문이 없습니다`);
    else if (!item?.why) bad.push(`${index + 1}번: 스스로 정할 수 없는 이유가 없습니다`);
  });
  return {
    ok: bad.length === 0,
    reason: bad.length > 0 ? `결정 요청이 불완전합니다 — ${bad.join(" · ")}` : null,
  };
}

/**
 * 실행이 **버려졌는지** 판정한다 — 순수 함수다.
 *
 * 작업은 비동기로 돈다. 요청은 바로 응답하고 Claude Code는 뒤에서 계속
 * 일한다. 그래서 "IN_PROGRESS인데 아무도 일하고 있지 않은" 상태가 생길 수
 * 있다 — 서버가 재시작됐거나 PC가 꺼졌을 때다. 그대로 두면 그 작업은
 * **영원히 실행되지 않는다.** 다음 `/run`이 REQUESTED만 찾기 때문이다.
 *
 * @param result   결과 기록 (없으면 null)
 * @param nowMs    현재 시각 (ms) — 이 모듈은 시계를 읽지 않는다
 * @param limitMs  이 시간 넘게 심장박동이 없으면 버려진 것으로 본다
 * @param liveRunIds 지금 이 프로세스가 실제로 돌리고 있는 runId 목록
 */
export function abandonedRun(result, nowMs, limitMs, liveRunIds = []) {
  if (result?.state !== "IN_PROGRESS") {
    return { abandoned: false, reason: null };
  }
  // 이 프로세스가 실제로 돌리고 있으면 살아 있는 것이다 — 시간과 무관하다.
  if (result.runId && liveRunIds.includes(result.runId)) {
    return { abandoned: false, reason: null };
  }
  // runId가 없다 = 비동기 구조 이전에 남은 기록이거나 다른 프로세스의 것.
  if (!result.runId) {
    return { abandoned: true, reason: "실행 식별자가 없습니다 (중단된 기록)" };
  }
  const beat = Date.parse(result.heartbeatAt ?? result.startedAt ?? "");
  if (!Number.isFinite(beat)) {
    return { abandoned: true, reason: "마지막 신호 시각이 없습니다" };
  }
  const idleMs = nowMs - beat;
  if (idleMs > limitMs) {
    return {
      abandoned: true,
      reason: `${Math.round(idleMs / 1000)}초 동안 신호가 없습니다`,
    };
  }
  return { abandoned: false, reason: null };
}

/** 작업 하나의 요약 — ChatGPT가 읽고 다음 지시를 정하는 데 쓴다 */
export function summarize(task, result) {
  return {
    taskId: task?.taskId ?? null,
    title: task?.title ?? null,
    state: result?.state ?? task?.state ?? "REQUESTED",
    costIncurred: result?.costIncurred ?? false,
    testsPassed: result?.testResults ?? null,
    blockedOn: result?.blockedOn ?? null,
    // 사람이 손대야 하는 자리는 둘이다 — 결과를 봐 줘야 할 때(READY_FOR_REVIEW)와
    // 결정을 내려 줘야 할 때(BLOCKED).
    needsHumanDecision: result?.state === "READY_FOR_REVIEW" || result?.state === "BLOCKED",
    decisionNeeded: result?.decisionNeeded ?? null,
    projectId: result?.projectId ?? task?.projectId ?? null,
    browserUrl: result?.browserUrl ?? null,
    // 비동기 실행의 진행 상황 — ChatGPT가 "아직 도는 중"인지 알 수 있어야 한다.
    runId: result?.runId ?? null,
    startedAt: result?.startedAt ?? null,
    heartbeatAt: result?.heartbeatAt ?? null,
    finishedAt: result?.finishedAt ?? null,
  };
}
