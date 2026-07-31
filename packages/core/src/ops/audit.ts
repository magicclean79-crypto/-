/**
 * 운영 감사 기록. (TASK-3801, Sprint 38 — CTO 정책 3801-④)
 *
 * `/ops/*`는 운영을 **바꾸는** 곳입니다: 스모크를 돌리고(돈이 나갑니다),
 * 백업을 돌리고, 단가를 적용하고, 장애를 열고 닫습니다. 그런데 지금까지
 * 남는 것은 그 결과물뿐이었습니다 — **누가 눌렀는지는 기록마다 제각각**
 * 이었고(스모크는 `actorId`를 남기고, 백업은 안 남깁니다), 무엇보다
 * **실패한 시도는 아무 데도 남지 않았습니다.**
 *
 * 장애 조사에서 가장 자주 필요한 문장이 그것입니다: **"그 시각에 누가
 * 무엇을 눌렀는가."** 성공한 것만 남는 기록으로는 답할 수 없습니다.
 *
 * ## 왜 자동으로 남기는가
 *
 * 각 서비스가 감사 기록을 "부르게" 하면, 다음에 추가되는 엔드포인트에서
 * 누군가 그 한 줄을 빠뜨립니다. 그리고 **빠진 감사 기록은 실패하지
 * 않습니다** — 아무 일도 안 일어나므로 아무도 모르고, 사고가 난 뒤에야
 * "그 경로는 기록이 없네요"를 알게 됩니다. 그래서 **가로채기(interceptor)**
 * 로 경로 전체에 한 번에 겁니다.
 *
 * ## 무엇을 남기지 않는가
 *
 * **조회(GET)는 남기지 않습니다.** 화면 한 번 열면 대여섯 개가 불리고,
 * 그것까지 남기면 진짜 변경이 소음에 묻힙니다. 그리고 **본문은 통째로
 * 남기지 않습니다** — `/ops/*` 요청 본문에는 자격 증명이 들어올 수 있고,
 * 감사 기록이 비밀을 흘리는 곳이 되면 안 됩니다.
 */

/** 감사에 남는 행동 — 경로·메서드에서 유도한다 */
export interface AuditAction {
  /** `smoke.run` 같은 안정적인 이름 (URL이 바뀌어도 이 이름은 유지한다) */
  action: string;
  /** 대상 식별자 — 경로에 있으면 (예: 장애 id) */
  target: string | null;
  /** 사람이 읽는 설명 */
  title: string;
}

/**
 * 감사 대상이 아닌 것 — 되풀이해서 불리고 아무것도 바꾸지 않는 것.
 *
 * `POST`라고 전부 변경은 아닙니다. 조회를 POST로 받는 경로가 있고
 * (본문이 길어서), 그런 것까지 남기면 기록이 소음이 됩니다.
 */
const READ_ONLY_POSTS = ["/ops/checks/preview", "/company-brain/query"];

/**
 * 알려진 경로 → **안정적인 행동 이름** (라이브 검증에서 고침).
 *
 * 처음에는 경로 조각에서 이름을 만들어 냈습니다. 그랬더니
 * `POST /ops/incidents`가 **`incident.run`** 이 됐습니다 — "장애를
 * 실행했다"로 읽히는 이름입니다. 이름이 어색하면 감사 기록을 읽는 사람이
 * 매번 경로를 다시 확인해야 하고, 그러면 목록이 목록으로 쓰이지 않습니다.
 *
 * 그래서 아는 경로는 **적어 둡니다.** URL이 바뀌어도 이 이름은 유지되므로,
 * "지난 분기에 스모크를 몇 번 돌렸나" 같은 질문이 경로 변경에 깨지지
 * 않습니다.
 */
const ROUTE_ACTIONS: {
  method: string;
  pattern: RegExp;
  action: string;
  title: string;
}[] = [
  { method: "POST", pattern: /^\/ops\/smoke$/, action: "smoke.run", title: "운영 스모크 실행 (실 호출·과금)" },
  { method: "POST", pattern: /^\/ops\/incidents$/, action: "incident.open", title: "장애 기록 생성" },
  { method: "POST", pattern: /^\/ops\/incidents\/:id\/resolve$/, action: "incident.resolve", title: "장애 복구 기록" },
  { method: "POST", pattern: /^\/ops\/incidents\/:id\/analysis$/, action: "incident.analysis", title: "장애 사후 분석 기록" },
  { method: "POST", pattern: /^\/ops\/checks\/run$/, action: "checks.run", title: "예약 점검 수동 실행" },
  { method: "POST", pattern: /^\/ops\/backup\/run$/, action: "backup.run", title: "백업 실행" },
  { method: "POST", pattern: /^\/ops\/backup\/verify-restore$/, action: "backup.verify-restore", title: "복원 검증" },
  { method: "POST", pattern: /^\/ops\/backup\/verify-remote$/, action: "backup.verify-remote", title: "원격 사본 대조" },
  { method: "POST", pattern: /^\/ops\/drills$/, action: "drill.create", title: "복구 리허설 기록" },
  { method: "POST", pattern: /^\/ops\/drills\/require$/, action: "drill.require", title: "추가 리허설 요구" },
  { method: "POST", pattern: /^\/ops\/drills\/requirements\/:id\/cancel$/, action: "drill.cancel", title: "리허설 요구 취소" },
  { method: "POST", pattern: /^\/ops\/pricing\/propose$/, action: "pricing.propose", title: "단가 제안" },
  { method: "POST", pattern: /^\/ops\/pricing\/detect$/, action: "pricing.detect", title: "가격 공지 감지" },
  { method: "POST", pattern: /^\/ops\/pricing\/:id\/.+$/, action: "pricing.advance", title: "단가 단계 전이" },
  { method: "POST", pattern: /^\/ops\/notifications\/verify-smtp$/, action: "notifications.verify-smtp", title: "메일 경로 확인" },
  { method: "POST", pattern: /^\/ops\/alerts\/archive$/, action: "alerts.archive", title: "경보 보관" },
];

/**
 * 요청 하나를 감사 행동으로 (순수 함수).
 *
 * 감사 대상이 아니면 `null`입니다. **모르는 경로도 남깁니다** — 이름을
 * 못 붙였다고 기록을 빠뜨리면, 새로 생긴 엔드포인트가 조용히 감사 밖에
 * 놓입니다.
 */
export function judgeAuditAction(
  method: string,
  path: string,
): AuditAction | null {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") {
    return null;
  }
  const clean = path.split("?")[0].replace(/\/+$/, "");
  if (READ_ONLY_POSTS.includes(clean)) {
    return null;
  }

  const segments = clean.split("/").filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  // id를 자리표시자로 바꿔 **경로 모양**으로 맞춘다 — 그러지 않으면 같은
  // 행동이 id마다 다른 이름을 갖게 되어 셀 수 없다
  const target = segments.find((segment) => looksLikeId(segment)) ?? null;
  const shape = `/${segments
    .map((segment) => (looksLikeId(segment) ? ":id" : segment))
    .join("/")}`;

  const known = ROUTE_ACTIONS.find(
    (route) => route.method === verb && route.pattern.test(shape),
  );
  if (known !== undefined) {
    return { action: known.action, target, title: known.title };
  }

  // 이름은 경로 모양에서 만들되, 제목에는 원래 경로를 그대로 적어 사람이
  // 무엇인지 알 수 있게 한다.
  const words = segments.slice(1).filter((segment) => !looksLikeId(segment));
  const noun = singular(words[0] ?? segments[0]);
  const tail = words.slice(1).join(".");
  const action = tail !== "" ? `${noun}.${tail}` : `${noun}.${verb.toLowerCase()}`;

  return { action, target, title: `${clean} (${verb})` };
}

/** cuid·uuid·숫자 id로 보이는 조각 */
function looksLikeId(segment: string): boolean {
  return (
    /^c[a-z0-9]{20,}$/i.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) ||
    /^\d+$/.test(segment)
  );
}

/** `incidents` → `incident` (행동 이름을 단수로 안정화한다) */
function singular(word: string): string {
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

/**
 * 본문에서 감사에 남겨도 되는 부분만 (순수 함수).
 *
 * **값이 아니라 이름만 남깁니다.** 무엇을 보냈는지가 아니라 **어떤 항목을
 * 건드렸는지**가 조사에 필요한 정보이고, 값까지 남기면 감사 기록이 자격
 * 증명·개인정보가 새는 곳이 됩니다.
 *
 * 다만 **판단에 쓰인 짧은 열거값**(등급·구성 요소 같은 것)은 남깁니다 —
 * "누가 CRITICAL 장애를 열었나"는 이름만으로는 답할 수 없습니다.
 */
export function summarizeAuditBody(body: unknown): string | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length === 0) {
    return null;
  }
  const parts = entries.map(([key, value]) => {
    if (SECRET_KEYS.some((secret) => key.toLowerCase().includes(secret))) {
      return `${key}=***`;
    }
    if (typeof value === "boolean" || typeof value === "number") {
      return `${key}=${String(value)}`;
    }
    if (typeof value === "string" && value.length <= 24 && SAFE_KEYS.includes(key)) {
      return `${key}=${value}`;
    }
    return key;
  });
  return parts.join(" · ").slice(0, 500);
}

/** 값을 남기지 않는 항목 이름 */
const SECRET_KEYS = ["key", "secret", "token", "password", "credential"];

/** 값까지 남기는 항목 — 판단의 근거가 되는 짧은 열거값만 */
const SAFE_KEYS = [
  "severity",
  "component",
  "stage",
  "job",
  "trigger",
  "fixKind",
  "provider",
  "target",
  "format",
];
