/**
 * 운영 전환 검증. (TASK-3401, Sprint 34 — CTO 지시 4·5·6)
 * 도달 점검 추가 (TASK-3501, Sprint 35 — CTO 지시 2·3)
 *
 * ## 이 파일이 막으려는 것: 스텁을 진짜로 세는 것
 *
 * 우리는 라이브 검증에서 **계약 스텁**을 씁니다 — Vision 스텁, 가격 공지 스텁,
 * s3rver. 스텁은 좋은 도구입니다. 계약이 맞는지 결정적으로 확인할 수 있고,
 * 남의 서비스에 돈을 쓰지 않습니다.
 *
 * 문제는 **성공 기록이 남는다**는 것입니다. `provider-rollout`(TASK-2901)은
 * "성공한 실행 기록이 있으면 연결됨"으로 판정합니다. 그 기록이 스텁을 상대로
 * 만들어졌다면, 화면은 **연결되지 않은 시스템을 연결됐다고 보고**합니다.
 * 우리가 가장 경계해 온 조용한 실패가 정확히 이 모양입니다.
 *
 * 그래서 이 파일은 **상대가 누구였는지**를 봅니다:
 *
 * | 판정 | 뜻 |
 * | --- | --- |
 * | `verified` | 공식 주소로 최근 성공 기록이 있다 — 운영 전환이 사실이다 |
 * | `not-production` | 돌고는 있지만 **운영의 그것이 아니다** (가짜·스텁 주소·개발용 엔진) |
 * | `unverified` | 설정은 됐는데 **성공 기록이 없다** — 붙는지 모른다 |
 * | `not-configured` | 아직 붙이지 않았다 — 실패가 아니다 |
 * | `invalid` | 설정이 잘못됐다 |
 * | `unreachable` | 공식 주소에 **닿지 못한다** — 자격 증명 이전의 문제다 |
 *
 * **`not-production`을 `verified`로 세지 않습니다.** 이 한 줄이 이 파일의
 * 전부입니다.
 *
 * `unreachable`을 따로 둔 이유(TASK-3501): 키가 틀린 것과 길이 막힌 것은 완전히
 * 다른 사실인데, 둘 다 "호출 실패"로 보이면 사람은 **있지도 않은 키 문제**를
 * 몇 시간씩 찾습니다. 실제로 이 환경에서 `api.openai.com`이 프록시에 막혀
 * 있었고, 그 사실은 키를 넣어 보기 전에는 드러나지 않았을 것입니다.
 */

import type { CiRunJudgement, CiWorkflowJudgement } from "./ci-workflow";

export type EndpointOrigin =
  /** Provider의 공식 주소 */
  | "official"
  /** 우리 컴퓨터·사설망 — 스텁이다 */
  | "local"
  /** 공식도 로컬도 아닌 곳 (프록시·게이트웨이일 수 있다) */
  | "third-party"
  /** 설정되지 않음 — SDK 기본값(공식 주소)을 쓴다 */
  | "unset";

export interface EndpointJudgement {
  origin: EndpointOrigin;
  host: string | null;
  detail: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function isLocalHost(host: string): boolean {
  if (LOCAL_HOSTS.has(host)) {
    return true;
  }
  if (host.endsWith(".local") || host.endsWith(".localhost")) {
    return true;
  }
  // 사설 대역 — 운영 Provider가 여기 있을 수는 없다
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/**
 * 엔드포인트가 **누구인지** 판정한다 (순수 함수).
 *
 * 설정되지 않은 것(`unset`)은 실패가 아닙니다 — 공식 SDK는 기본값으로 공식
 * 주소를 씁니다. 위험한 것은 **설정됐는데 공식이 아닌 경우**입니다.
 */
export function judgeEndpointOrigin(
  url: string | null | undefined,
  officialSuffixes: string[],
): EndpointJudgement {
  if (url === null || url === undefined || url.trim() === "") {
    return {
      origin: "unset",
      host: null,
      detail: `설정되지 않았습니다 — 공식 주소(${officialSuffixes.join(" · ")})를 씁니다.`,
    };
  }
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return {
      origin: "third-party",
      host: null,
      detail: `주소를 해석할 수 없습니다: ${url}`,
    };
  }
  if (officialSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return { origin: "official", host, detail: `공식 주소입니다 (${host}).` };
  }
  if (isLocalHost(host)) {
    return {
      origin: "local",
      host,
      detail:
        `우리 컴퓨터를 가리킵니다 (${host}) — 스텁입니다. 여기서 만들어진 성공 기록은 ` +
        "Provider와 통신한 증거가 아닙니다.",
    };
  }
  return {
    origin: "third-party",
    host,
    detail:
      `공식 주소가 아닙니다 (${host}) — 프록시·게이트웨이일 수 있습니다. ` +
      "무엇인지 확인되기 전까지 운영 전환으로 세지 않습니다.",
  };
}

export type CutoverStatus =
  | "verified"
  | "not-production"
  | "unverified"
  | "not-configured"
  | "invalid"
  /**
   * 공식 주소에 **닿지 못한다** (TASK-3501 — CTO 지시 2).
   *
   * 설정 이전의 문제입니다. 키가 틀린 것과 길이 막힌 것은 완전히 다른
   * 사실인데, 둘 다 "호출 실패"로 보이면 사람은 **있지도 않은 키 문제**를
   * 몇 시간씩 찾습니다. 그래서 따로 둡니다.
   */
  | "unreachable";

export type CutoverDependencyId = "llm" | "vision" | "storage" | "ci";

export interface CutoverDependency {
  id: CutoverDependencyId;
  title: string;
  status: CutoverStatus;
  detail: string;
  /** 이 항목과 관련된 환경변수 */
  env: string[];
  /** 판정 근거 (없으면 null — 근거 없이 통과시키지 않는다) */
  evidence: string | null;
  /** 사람이 다음에 할 일 */
  next: string;
}

export interface CutoverReport {
  dependencies: CutoverDependency[];
  summary: { verified: number; total: number };
  /** 전부 `verified`인가 — 하나라도 아니면 운영 전환은 끝난 것이 아니다 */
  ready: boolean;
  detail: string;
}

/** LLM Provider별 공식 주소와 주소 재정의 환경변수 */
const LLM_PROVIDERS: Record<
  string,
  { keyEnv: string; baseUrlEnv: string | null; official: string[] }
> = {
  openai: {
    keyEnv: "OPENAI_API_KEY",
    // 공식 SDK가 읽는 재정의 창구 — 우리 코드가 안 읽어도 SDK는 읽는다
    baseUrlEnv: "OPENAI_BASE_URL",
    official: ["api.openai.com"],
  },
  anthropic: {
    keyEnv: "ANTHROPIC_API_KEY",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    official: ["api.anthropic.com"],
  },
  gemini: {
    keyEnv: "GEMINI_API_KEY",
    baseUrlEnv: null,
    official: ["generativelanguage.googleapis.com"],
  },
};

export const GOOGLE_VISION_OFFICIAL_HOST = "vision.googleapis.com";
export const AWS_S3_OFFICIAL_HOST = "amazonaws.com";

/**
 * 공식 주소 도달 점검 결과 (TASK-3501 — CTO 지시 2).
 *
 * **자격 증명 이전의 조건입니다.** 키를 받아 넣어도 방화벽·프록시가 그 주소를
 * 막고 있으면 전환은 되지 않고, 그때 나오는 오류는 키 문제처럼 보입니다.
 */
export type EgressStatus =
  /** 그 호스트가 응답했다 — 인증 실패(401)도 닿은 것이다 */
  | "reachable"
  /** 연결 자체가 되지 않았다 (거부·타임아웃·터널 실패) */
  | "blocked"
  /**
   * 403이 왔다 — **누가 막았는지 알 수 없다.**
   *
   * Provider가 거절한 것일 수도, 중간 프록시가 막은 것일 수도 있습니다.
   * 실제로 이 프로젝트의 검증 환경에서 `api.openai.com`의 403은 **프록시가**
   * 막은 것이었는데, 처음 판정은 그것을 "닿음"으로 셌습니다. 구분할 수 없는
   * 것을 구분한 척하지 않고 모른다고 말합니다.
   */
  | "ambiguous";

export interface EgressProbe {
  host: string;
  status: EgressStatus;
  /**
   * 닿았는가 — `reachable`일 때만 참입니다.
   *
   * `ambiguous`는 **참이 아닙니다**: 모르는 것을 닿는다고 말하지 않습니다.
   * 다만 막혔다고도 말하지 않으므로 판정을 `unreachable`로 바꾸지도 않습니다.
   */
  reachable: boolean;
  /** 응답 상태 또는 오류 설명 */
  detail: string;
}

export interface CutoverInput {
  env: Record<string, string | undefined>;
  /** LLM Provider별 최근 성공한 실 호출 수 */
  llmSuccesses: Record<string, number>;
  /** OCR 엔진별 최근 성공한 실행 수 */
  ocrSuccesses: Record<string, number>;
  /** 저장소 접근 점검 — 모르면 null (모르는 것을 통과로 세지 않는다) */
  storage: { reachable: boolean; bucketExists: boolean; detail: string } | null;
  /** CI 파일·실행 판정 — 모르면 null */
  ci: { workflow: CiWorkflowJudgement; runs: CiRunJudgement } | null;
  /**
   * 공식 주소 도달 점검 (TASK-3501) — 안 했으면 빈 배열.
   *
   * **점검하지 않은 것을 "닿는다"로 보지 않습니다.** 빈 배열이면 이 판정을
   * 쓰지 않을 뿐이고, 막혀 있다고 말하지도 않습니다.
   */
  egress?: EgressProbe[];
}

/** 이 호스트가 막혀 있는가 — 점검하지 않았으면 null(모름) */
function egressOf(
  input: CutoverInput,
  host: string,
): EgressProbe | null {
  return input.egress?.find((probe) => probe.host === host) ?? null;
}

function judgeLlm(input: CutoverInput): CutoverDependency {
  const name = (input.env.LLM_PROVIDER ?? "mock").trim().toLowerCase();
  const base: Omit<CutoverDependency, "status" | "detail" | "evidence" | "next"> = {
    id: "llm",
    title: "LLM (실 Provider 호출)",
    env: ["LLM_PROVIDER"],
  };

  if (name === "mock") {
    return {
      ...base,
      status: "not-production",
      detail:
        "LLM_PROVIDER가 mock입니다 — 결과는 나오지만 Provider를 부르지 않습니다. " +
        "이 상태의 성공 기록은 연결의 증거가 아닙니다.",
      evidence: null,
      next: "OPENAI_API_KEY 등 실 키를 넣고 LLM_PROVIDER를 실 Provider로 바꾸세요.",
    };
  }

  const spec = LLM_PROVIDERS[name];
  if (spec === undefined) {
    return {
      ...base,
      status: "invalid",
      detail: `알 수 없는 LLM_PROVIDER입니다: ${name} — 구현된 것은 ${Object.keys(
        LLM_PROVIDERS,
      ).join("·")}·mock입니다.`,
      evidence: null,
      next: "LLM_PROVIDER 값을 확인하세요.",
    };
  }

  const env = [...base.env, spec.keyEnv, ...(spec.baseUrlEnv ? [spec.baseUrlEnv] : [])];
  const key = input.env[spec.keyEnv];
  if (key === undefined || key.trim() === "") {
    const blocked = egressOf(input, spec.official[0]);
    const isBlocked = blocked !== null && blocked.status === "blocked";
    return {
      ...base,
      env,
      status: "not-configured",
      detail:
        `${spec.keyEnv}가 없습니다 — 아직 붙이지 않은 상태입니다(실패가 아닙니다).` +
        (isBlocked
          ? ` 덧붙여 ${spec.official[0]}에 닿지도 못합니다 (${blocked!.detail}) — 키를 넣어도 이 길이 열리기 전까지는 붙지 않습니다.`
          : ""),
      evidence: null,
      next: `${spec.keyEnv}를 설정하세요.`,
    };
  }

  const endpoint =
    spec.baseUrlEnv === null
      ? ({ origin: "unset", host: null, detail: "" } as EndpointJudgement)
      : judgeEndpointOrigin(input.env[spec.baseUrlEnv], spec.official);
  const successes = input.llmSuccesses[name] ?? 0;

  if (endpoint.origin === "local" || endpoint.origin === "third-party") {
    return {
      ...base,
      env,
      status: "not-production",
      detail:
        `${spec.baseUrlEnv}로 주소가 바뀌어 있습니다 — ${endpoint.detail} ` +
        (successes > 0
          ? `성공 기록 ${successes}건은 이 주소를 상대로 만들어졌으므로 운영 연결의 증거가 아닙니다.`
          : ""),
      evidence: null,
      next: `${spec.baseUrlEnv}를 비워 공식 주소로 되돌린 뒤 다시 확인하세요.`,
    };
  }

  // 길이 막혀 있으면 키 이야기를 하기 전에 그것부터 말한다 (TASK-3501)
  const reach = egressOf(input, spec.official[0]);
  if (reach !== null && reach.status === "ambiguous") {
    return {
      ...base,
      env,
      status: "unverified",
      // 점검 문구가 이미 "가릴 수 없습니다"를 말한다 — 되풀이하지 않는다
      // (TASK-3401에서 같은 겹침을 라이브에서 보고 고쳤다)
      detail: `${spec.official[0]} 도달 점검: ${reach.detail}`,
      evidence: null,
      next: "실제 호출을 1회 돌려 응답 본문이 Provider의 것인지 확인하세요.",
    };
  }
  if (reach !== null && reach.status === "blocked") {
    return {
      ...base,
      env,
      status: "unreachable",
      detail:
        `${spec.official[0]}에 닿지 못합니다 — ${reach.detail}. 키가 틀린 것이 아니라 ` +
        "길이 막혀 있습니다. 이 상태에서 나오는 호출 실패는 키 문제처럼 보이지만 아닙니다.",
      evidence: null,
      next: `방화벽·프록시에서 ${spec.official[0]} 아웃바운드를 열어 주세요.`,
    };
  }

  if (successes > 0) {
    return {
      ...base,
      env,
      status: "verified",
      detail: `${name} 공식 주소로 최근 성공한 실 호출이 ${successes}건 있습니다.`,
      evidence: `${name} 실 호출 성공 ${successes}건`,
      next: "추가 조치가 없습니다.",
    };
  }

  return {
    ...base,
    env,
    status: "unverified",
    detail:
      `${spec.keyEnv}는 있지만 최근 성공한 실 호출 기록이 없습니다 — 키가 있다는 것과 ` +
      "붙는다는 것은 다릅니다.",
    evidence: null,
    next: "POST /ops/checks/run?job=provider-smoke 또는 실제 생성 1회로 확인하세요.",
  };
}

function judgeVision(input: CutoverInput): CutoverDependency {
  const engine = (input.env.OCR_PROVIDER ?? "mock").trim().toLowerCase();
  const base = {
    id: "vision" as const,
    title: "Google Cloud Vision (OCR)",
    env: ["OCR_PROVIDER", "GOOGLE_VISION_API_KEY", "GOOGLE_VISION_ENDPOINT"],
  };

  if (engine === "mock") {
    return {
      ...base,
      status: "not-production",
      detail:
        "OCR_PROVIDER가 mock입니다 — 이미지에서 실제로 글자를 읽지 않습니다. " +
        "그 텍스트로 조립된 상품은 사실이 아닙니다.",
      evidence: null,
      next: "OCR_PROVIDER=google-vision과 GOOGLE_VISION_API_KEY를 설정하세요.",
    };
  }
  if (engine !== "google-vision") {
    return {
      ...base,
      status: "not-production",
      detail:
        `OCR_PROVIDER가 ${engine}입니다 — 글자는 실제로 읽지만 운영 표준(google-vision)이 ` +
        "아닙니다 (CTO 결정 2401-⑤).",
      evidence: null,
      next: "운영 전환에는 OCR_PROVIDER=google-vision이 필요합니다.",
    };
  }

  const key = input.env.GOOGLE_VISION_API_KEY;
  if (key === undefined || key.trim() === "") {
    const blocked = egressOf(input, GOOGLE_VISION_OFFICIAL_HOST);
    const isBlocked = blocked !== null && blocked.status === "blocked";
    return {
      ...base,
      status: "not-configured",
      detail:
        "GOOGLE_VISION_API_KEY가 없습니다 — google-vision을 쓰려면 키가 필요합니다." +
        (isBlocked
          ? ` 덧붙여 ${GOOGLE_VISION_OFFICIAL_HOST}에 닿지도 못합니다 (${blocked!.detail}).`
          : ""),
      evidence: null,
      next: "Google Cloud 콘솔에서 Vision API 키를 발급해 설정하세요.",
    };
  }

  const endpoint = judgeEndpointOrigin(input.env.GOOGLE_VISION_ENDPOINT, [
    GOOGLE_VISION_OFFICIAL_HOST,
  ]);
  const successes = input.ocrSuccesses["google-vision"] ?? 0;

  if (endpoint.origin === "local" || endpoint.origin === "third-party") {
    return {
      ...base,
      status: "not-production",
      detail:
        `GOOGLE_VISION_ENDPOINT가 공식 주소가 아닙니다 — ${endpoint.detail} ` +
        (successes > 0
          ? `성공 기록 ${successes}건은 이 주소를 상대로 만들어졌습니다.`
          : ""),
      evidence: null,
      next: "GOOGLE_VISION_ENDPOINT를 비워 공식 주소로 되돌린 뒤 OCR을 1회 돌리세요.",
    };
  }

  const reach = egressOf(input, GOOGLE_VISION_OFFICIAL_HOST);
  if (reach !== null && reach.status === "blocked") {
    return {
      ...base,
      status: "unreachable",
      detail:
        `${GOOGLE_VISION_OFFICIAL_HOST}에 닿지 못합니다 — ${reach.detail}. 키가 틀린 것이 ` +
        "아니라 길이 막혀 있습니다.",
      evidence: null,
      next: `방화벽·프록시에서 ${GOOGLE_VISION_OFFICIAL_HOST} 아웃바운드를 열어 주세요.`,
    };
  }

  if (successes > 0) {
    return {
      ...base,
      status: "verified",
      detail: `공식 주소(${GOOGLE_VISION_OFFICIAL_HOST})로 최근 성공한 OCR이 ${successes}건 있습니다.`,
      evidence: `google-vision OCR 성공 ${successes}건`,
      next: "추가 조치가 없습니다.",
    };
  }

  return {
    ...base,
    status: "unverified",
    detail:
      "키는 있고 주소도 공식이지만 최근 성공한 OCR 기록이 없습니다 — 실제로 읽히는지는 아직 모릅니다.",
    evidence: null,
    next: "이미지 1장으로 POST /images/:id/ocr을 돌려 확인하세요.",
  };
}

function judgeStorage(input: CutoverInput): CutoverDependency {
  const base = {
    id: "storage" as const,
    title: "Amazon S3 (운영 저장소)",
    env: ["S3_ENDPOINT", "S3_BUCKET", "BACKUP_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"],
  };
  const endpoint = judgeEndpointOrigin(input.env.S3_ENDPOINT, [AWS_S3_OFFICIAL_HOST]);

  if (endpoint.origin === "unset") {
    return {
      ...base,
      status: "not-configured",
      detail:
        "S3_ENDPOINT가 없습니다 — 애플리케이션은 개발 기본값(http://localhost:9000)으로 " +
        "돕니다. 아직 전환하지 않은 상태입니다(실패가 아닙니다).",
      evidence: null,
      next: "docs/operations/s3-migration.md §4의 절차대로 버킷·IAM을 준비한 뒤 설정하세요.",
    };
  }
  if (endpoint.origin !== "official") {
    return {
      ...base,
      status: "not-production",
      detail:
        `운영 저장소가 Amazon S3가 아닙니다 (${endpoint.host ?? "?"}) — MinIO·s3rver는 개발 ` +
        "전용이며 버전 관리·복제 조회를 지원하지 않아 보호 상태를 확인할 수 없습니다 " +
        "(CTO 결정 1901-③).",
      evidence: null,
      next: "S3_ENDPOINT를 https://s3.<region>.amazonaws.com으로 바꾸세요.",
    };
  }

  // 주소가 S3인데 자격 증명이 개발 기본값이면 전환은 끝난 것이 아니다 —
  // 기본값을 그대로 두면 운영에서 인증 실패가 "S3 장애"처럼 보인다
  const accessKey = (input.env.S3_ACCESS_KEY ?? "").trim();
  const secretKey = (input.env.S3_SECRET_KEY ?? "").trim();
  if (accessKey === "" || secretKey === "" || accessKey === "minioadmin") {
    return {
      ...base,
      status: "invalid",
      detail:
        "S3 주소는 Amazon인데 자격 증명이 비어 있거나 개발 기본값(minioadmin)입니다 — " +
        "이 상태의 인증 실패는 저장소 장애처럼 보입니다.",
      evidence: null,
      next: "IAM 자격 증명을 S3_ACCESS_KEY·S3_SECRET_KEY에 설정하세요 (s3-migration.md §3).",
    };
  }

  const bucket = (input.env.S3_BUCKET ?? "").trim();
  const backup = (input.env.BACKUP_BUCKET ?? "").trim();
  if (bucket !== "" && backup !== "" && bucket === backup) {
    return {
      ...base,
      status: "invalid",
      detail:
        `이미지 버킷과 백업 버킷이 같습니다 (${bucket}) — 그 버킷이 사라지면 이미지와 ` +
        "백업이 함께 사라집니다 (CTO 결정 1701-②).",
      evidence: null,
      next: "BACKUP_BUCKET을 별도 버킷으로 나누세요.",
    };
  }

  const reach = endpoint.host === null ? null : egressOf(input, endpoint.host);
  if (reach !== null && reach.status === "blocked") {
    return {
      ...base,
      status: "unreachable",
      detail: `${endpoint.host}에 닿지 못합니다 — ${reach.detail}. 자격 증명 이전의 문제입니다.`,
      evidence: null,
      next: `방화벽·프록시에서 ${endpoint.host} 아웃바운드를 열어 주세요.`,
    };
  }

  if (input.storage === null) {
    return {
      ...base,
      status: "unverified",
      detail:
        "설정은 Amazon S3인데 접근 점검 결과가 없습니다 — 설정과 접근 가능은 다릅니다.",
      evidence: null,
      next: "GET /ops/readiness로 버킷 접근을 확인하세요.",
    };
  }
  if (!input.storage.reachable || !input.storage.bucketExists) {
    return {
      ...base,
      status: "invalid",
      detail: `Amazon S3에 접근하지 못했습니다 — ${input.storage.detail}`,
      evidence: null,
      next: "IAM 권한(s3:ListBucket)과 버킷 이름을 확인하세요.",
    };
  }

  return {
    ...base,
    status: "verified",
    detail: `Amazon S3(${endpoint.host})에 접근했고 버킷이 있습니다 — ${input.storage.detail}`,
    evidence: input.storage.detail,
    next: "버전 관리·복제 판정은 /admin/operations의 저장소 보호 항목에서 확인하세요.",
  };
}

function judgeCi(input: CutoverInput): CutoverDependency {
  const base = {
    id: "ci" as const,
    title: "GitHub Actions (품질 게이트)",
    env: [],
  };
  if (input.ci === null) {
    return {
      ...base,
      status: "unverified",
      detail:
        "CI 판정 결과가 없습니다 — 워크플로 파일도 실행 이력도 확인하지 못했습니다.",
      evidence: null,
      next: "워크플로 파일과 최근 실행 결과를 확인하세요.",
    };
  }
  const { workflow, runs } = input.ci;

  if (!workflow.ok) {
    return {
      ...base,
      status: "invalid",
      detail: `워크플로에 문제가 있습니다 — ${workflow.detail}`,
      evidence: null,
      next: ".github/workflows/ci.yml을 고치세요.",
    };
  }
  if (runs.status === "unknown") {
    return {
      ...base,
      status: "unverified",
      detail: runs.detail,
      evidence: null,
      next: "이 브랜치에 푸시해 워크플로를 한 번 돌리세요.",
    };
  }
  if (runs.status === "running") {
    return {
      ...base,
      status: "unverified",
      detail: runs.detail,
      evidence: null,
      next: "실행이 끝난 뒤 다시 확인하세요.",
    };
  }
  if (runs.status === "red") {
    return {
      ...base,
      status: "invalid",
      detail:
        `${runs.detail} 게이트가 파일에 적혀 있는 것과 초록으로 끝나는 것은 다릅니다.`,
      evidence: null,
      next: "실패한 작업의 로그를 보고 원인을 고치세요.",
    };
  }

  return {
    ...base,
    status: "verified",
    detail: `${runs.detail} 필수 게이트 ${workflow.gates.length}개가 순서대로 돌았습니다.`,
    evidence: runs.latest === null ? null : `run ${runs.latest.id} (${runs.latest.sha.slice(0, 8)})`,
    next: "추가 조치가 없습니다.",
  };
}

/**
 * 운영 전환 상태를 판정한다 (순수 함수).
 *
 * **하나라도 `verified`가 아니면 `ready`는 false입니다.** 네 항목 중 셋이
 * 초록이어도 "거의 다 됐다"는 판정을 만들지 않습니다 — 운영 전환은 부분
 * 점수가 없습니다: 스텁 하나가 남아 있으면 그 경로의 결과는 여전히 사실이
 * 아닙니다.
 */
export function judgeProductionCutover(input: CutoverInput): CutoverReport {
  const dependencies = [
    judgeLlm(input),
    judgeVision(input),
    judgeStorage(input),
    judgeCi(input),
  ];
  const verified = dependencies.filter((row) => row.status === "verified").length;
  const pending = dependencies.filter((row) => row.status !== "verified");

  return {
    dependencies,
    summary: { verified, total: dependencies.length },
    ready: pending.length === 0,
    detail:
      pending.length === 0
        ? `운영 전환 ${verified}/${dependencies.length}항목이 실제 연결로 확인됐습니다.`
        : `운영 전환 ${verified}/${dependencies.length}항목 확인 — 남은 항목: ` +
          `${pending.map((row) => `${row.title}(${row.status})`).join(", ")}. ` +
          "확인되지 않은 항목을 전환 완료로 세지 않습니다.",
  };
}
