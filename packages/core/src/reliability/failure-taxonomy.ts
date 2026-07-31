/**
 * 실패 분류. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * 지금까지 이 저장소의 실패 처리는 **경로마다 따로** 있었습니다. OCR은
 * 자기 타임아웃을, 알림은 자기 재시도를, 스모크는 자기 판정을 가지고
 * 있습니다. 각각은 정확한데 **한 가지 질문에 답할 수 없었습니다**:
 *
 * > 지금 이 실패는 **다시 해 볼 만한 실패인가, 사람이 고쳐야 하는 실패인가.**
 *
 * 그 답이 없으면 두 가지 사고가 납니다. 고칠 수 없는 실패를 계속 재시도해
 * 돈과 시간을 태우거나, 잠깐의 흔들림을 영구 실패로 적어 사람을 부릅니다.
 *
 * ## 이 파일이 하지 않는 일
 *
 * **기존 경로의 판정을 바꾸지 않습니다.** 알림의 `isRetriable`(1401),
 * OCR의 타임아웃(2901), 스모크의 `judgeSmokeProbe`(3701)는 그대로입니다.
 * 여기는 **새로 붙는 경로**가 쓰는 공통 분류이며, 기존 판정과 결론이
 * 어긋나지 않도록 같은 규칙(4xx는 재시도하지 않는다)을 따릅니다.
 *
 * ## 사용자 문장과 운영자 문장을 가릅니다
 *
 * 같은 실패라도 두 사람이 알아야 하는 것이 다릅니다:
 *
 * - **사용자**는 "무엇을 하면 되는가"를 알아야 합니다. 스택 트레이스·내부
 *   주소·모델 이름은 도움이 안 되고, 그중 일부는 **알려 주면 안 되는
 *   것**입니다.
 * - **운영자**는 "무엇이 일어났는가"를 알아야 합니다. 여기서 뭉개면
 *   장애 때 로그를 손으로 뒤지게 됩니다.
 *
 * 그래서 하나의 분류가 **두 문장**을 돌려줍니다. 사용자 문장에 원문을
 * 그대로 넣지 않는 이유는, 원문에 무엇이 들어 있는지 우리가 미리 알 수
 * 없기 때문입니다.
 */

/** 실패의 종류 */
export type FailureKind =
  /** 상대에 닿지 못했다 (DNS·연결 거부·소켓) */
  | "network"
  /** 시간 안에 답이 오지 않았다 */
  | "timeout"
  /** 상대가 "네 요청이 잘못됐다"고 했다 (4xx) */
  | "rejected"
  /** 인증·권한 (401·403) */
  | "unauthorized"
  /** 너무 자주 불렀다 (429) */
  | "throttled"
  /** 상대가 고장 났다 (5xx) */
  | "upstream"
  /** 우리 데이터베이스 */
  | "database"
  /** 우리 저장소(S3·파일) */
  | "storage"
  /** 우리가 막았다 (예산·게이트·검증) */
  | "blocked"
  /** 입력이 규칙에 안 맞는다 */
  | "invalid-input"
  /** 무엇인지 모른다 */
  | "unknown";

export interface FailureVerdict {
  kind: FailureKind;
  /** 다시 해 볼 만한가 */
  retriable: boolean;
  /**
   * 사용자에게 보여 줄 문장. **원문을 그대로 넣지 않습니다** — 원문에
   * 무엇이 들어 있는지 미리 알 수 없습니다.
   */
  userMessage: string;
  /** 운영자에게 보여 줄 문장 — 여기서는 뭉개지 않습니다 */
  operatorDetail: string;
  /** 상대가 준 상태 코드 — 없으면 null */
  status: number | null;
}

/** 종류별 기본 문장 — 사람이 다음에 할 일이 있으면 그것까지 */
const USER_MESSAGE: Record<FailureKind, string> = {
  network: "외부 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  timeout: "처리 시간이 예상보다 길어져 중단했습니다. 잠시 후 다시 시도해 주세요.",
  rejected: "요청 내용을 처리할 수 없습니다. 입력을 확인해 주세요.",
  unauthorized:
    "외부 서비스 인증에 실패했습니다. 관리자에게 알려 주세요 — 사용자가 고칠 수 있는 문제가 아닙니다.",
  throttled: "요청이 몰려 잠시 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  upstream:
    "외부 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.",
  database: "데이터를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  storage: "파일을 읽거나 쓰지 못했습니다. 잠시 후 다시 시도해 주세요.",
  // 막은 것은 실패가 아니라 **정책**입니다 — "다시 시도"라고 하면 안 됩니다.
  blocked: "지금은 이 작업을 실행할 수 없습니다. 화면에 적힌 이유를 확인해 주세요.",
  "invalid-input": "입력이 올바르지 않습니다. 내용을 확인한 뒤 다시 시도해 주세요.",
  unknown:
    "알 수 없는 오류가 발생했습니다. 문제가 계속되면 관리자에게 알려 주세요.",
};

/**
 * 재시도해도 결과가 달라질 수 있는 종류.
 *
 * 알림의 `isRetriable`(TASK-1401)과 **같은 규칙**입니다 — 4xx는 다시
 * 보내도 같은 답이 옵니다. 두 곳에서 다른 결론이 나오면 "왜 이건 재시도했고
 * 저건 안 했지"에 답할 수 없습니다.
 */
const RETRIABLE: ReadonlySet<FailureKind> = new Set<FailureKind>([
  "network",
  "timeout",
  "throttled",
  "upstream",
  "database",
  "storage",
]);

/**
 * 아무 오류나 받아 분류한다 (순수 함수).
 *
 * **모르면 `unknown`이고, `unknown`은 재시도하지 않습니다.** 모르는 실패를
 * 재시도하면 어떤 실패인지 영영 모른 채로 돈만 씁니다.
 */
export function classifyFailure(
  error: unknown,
  hint?: { status?: number | null; kind?: FailureKind },
): FailureVerdict {
  const message = messageOf(error);
  const status = hint?.status ?? statusOf(error);
  const kind = hint?.kind ?? inferKind(error, message, status);

  return {
    kind,
    // **막은 것은 재시도 대상이 아닙니다** — 정책은 기다린다고 바뀌지 않습니다.
    retriable: RETRIABLE.has(kind),
    userMessage: USER_MESSAGE[kind] ?? USER_MESSAGE.unknown,
    operatorDetail:
      `${LABEL[kind]}${status === null ? "" : ` (HTTP ${status})`}: ` +
      (message === "" ? "원문 없음" : message),
    status,
  };
}

const LABEL: Record<FailureKind, string> = {
  network: "연결 실패",
  timeout: "시간 초과",
  rejected: "상대가 거절",
  unauthorized: "인증·권한 실패",
  throttled: "호출 제한",
  upstream: "상대 서버 오류",
  database: "데이터베이스 오류",
  storage: "저장소 오류",
  blocked: "정책으로 막음",
  "invalid-input": "입력 오류",
  unknown: "분류하지 못한 오류",
};

/**
 * 우리가 막은 것을 알아보는 문구.
 *
 * **상태 코드보다 먼저 봅니다** — 라이브 검증에서 잡은 것: 예산 초과는
 * HTTP 429로 나가는데(그것 자체는 옳은 선택입니다), 상태 코드만 보면
 * `throttled`가 되어 **"잠시 후 다시 시도해 주세요"** 라고 말하게 됩니다.
 * 예산은 기다린다고 열리지 않고, 재시도하면 **돈이 나가는 호출을
 * 반복**합니다.
 *
 * 우리 문구로만 매칭합니다 — 상대 서비스의 429 본문에 이 말이 들어 있을
 * 리 없습니다.
 */
const BLOCKED_HINTS = [
  "예산을 초과",
  "차단했습니다",
  "막았습니다",
  "실행할 수 없습니다",
  "강제로 여는 방법은 없습니다",
];

function inferKind(
  error: unknown,
  message: string,
  status: number | null,
): FailureKind {
  // **우리가 막은 것이 먼저입니다.** 뒤에 두면 상태 코드가 먼저 결론을
  // 내고, 정책이 상대의 혼잡으로 읽힙니다.
  if (BLOCKED_HINTS.some((hint) => message.includes(hint))) {
    return "blocked";
  }

  if (status !== null) {
    if (status === 401 || status === 403) return "unauthorized";
    if (status === 429) return "throttled";
    if (status >= 500) return "upstream";
    if (status >= 400) return "rejected";
  }

  const code = codeOf(error);
  if (code !== null) {
    // Node/undici가 주는 코드 — 문자열 매칭보다 먼저 본다
    if (["ETIMEDOUT", "ESOCKETTIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code)) {
      return "timeout";
    }
    if (["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"].includes(code)) {
      return "network";
    }
    // Prisma는 P로 시작하는 코드를 준다
    if (/^P\d{4}$/.test(code)) {
      return "database";
    }
  }

  const lower = message.toLowerCase();
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (/timed? ?out|시간 안에|시간 초과|deadline/.test(lower)) return "timeout";
  if (/fetch failed|network|socket hang up|연결/.test(lower)) return "network";
  if (/prisma|database|데이터베이스/.test(lower)) return "database";
  if (/s3|storage|저장소|nosuchkey|nosuchbucket/.test(lower)) return "storage";
  if (/budget|forbidden by policy/.test(lower)) return "blocked";

  return "unknown";
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    // `cause`까지 본다 — undici는 진짜 원인을 여기에 넣는다
    const cause = (error as { cause?: unknown }).cause;
    const causeText =
      cause instanceof Error ? ` (원인: ${cause.message})` : "";
    return `${error.message}${causeText}`;
  }
  if (typeof error === "string") return error;
  if (error === null || error === undefined) return "";
  return String(error);
}

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  for (const key of ["status", "statusCode", "httpStatus"]) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  const response = (error as { response?: { status?: unknown } }).response;
  if (response && typeof response.status === "number") {
    return response.status;
  }
  return null;
}

function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (error as { cause?: { code?: unknown } }).cause;
  if (cause && typeof cause.code === "string") return cause.code;
  return null;
}
