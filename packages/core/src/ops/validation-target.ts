/**
 * 검증 대상 보호. (TASK-4101, Sprint 41 — CTO 정책 4101-①)
 *
 * TASK-4001은 `VALIDATION_TARGET_URL`을 **형식만** 검사했습니다. http(s)로
 * 시작하면 받아들였습니다. 그 상태에서 이 값이 하는 일을 생각해 보면
 * 문제가 분명해집니다 — 이 주소는 **실 자격 증명으로 과금되는 호출을 돌릴
 * 곳**입니다.
 *
 * ## 잘못 적으면 설정 실수가 아니라 사고입니다
 *
 * | 잘못 | 무슨 일이 일어나는가 |
 * | --- | --- |
 * | 운영 주소를 적는다 | 검증 스프린트가 **운영 데이터에** 장애를 만들려고 시도합니다 |
 * | 지금 이 인스턴스를 적는다 | 검증 대상과 검증 도구가 같아져 **자기가 자기를 검증**합니다 |
 * | 노트북 주소를 적는다 | 운영 키가 개발 기기에서 나갑니다 |
 *
 * 셋 다 **한 글자 차이로** 일어납니다. 그리고 셋 다 일어난 다음에야
 * 드러납니다.
 *
 * ## 그래서 두 가지를 요구합니다
 *
 * 1. **주소를 검사합니다** — 운영 호스트 목록과 대조하고, 지금 도는 곳과
 *    같은지 보고, 사설망인지 봅니다.
 * 2. **따로 확인을 받습니다**(`VALIDATION_TARGET_ACK`) — 주소를 **적는
 *    것**과 그곳에 돈이 나가는 호출을 **돌려도 된다고 말하는 것**은 다른
 *    행동입니다. 배포 설정을 복사하다 딸려 온 값과 사람이 의도해서 넣은
 *    값을 가릴 방법이 그것밖에 없습니다. (단가 2차 승인(3301-②)에서 쓴
 *    것과 같은 판단입니다.)
 */

export const VALIDATION_TARGET_ENV = "VALIDATION_TARGET_URL";
export const VALIDATION_TARGET_ACK_ENV = "VALIDATION_TARGET_ACK";
export const PRODUCTION_HOSTS_ENV = "PRODUCTION_HOSTS";

export type ValidationTargetVerdict =
  /** 아직 정하지 않았다 — **실패가 아니다** */
  | "unset"
  /** 주소로 읽을 수 없다 */
  | "invalid"
  /** 운영을 가리킨다 — 검증이 아니라 사고다 */
  | "production"
  /** 지금 도는 이 인스턴스를 가리킨다 */
  | "self"
  /** 우리 컴퓨터·사설망을 가리킨다 */
  | "local"
  /** 주소는 성립하는데 **돌려도 된다는 확인이 없다** */
  | "unacknowledged"
  /** 검증 대상으로 쓸 수 있다 */
  | "accepted";

export interface ValidationTargetJudgement {
  verdict: ValidationTargetVerdict;
  /** 정규화된 주소 — 읽을 수 없으면 null */
  url: string | null;
  host: string | null;
  /** 이 대상에 실 호출을 돌려도 되는가 — `accepted`일 때만 true */
  usable: boolean;
  detail: string;
  /** 사람이 다음에 할 일 — 문제가 없으면 null */
  next: string | null;
}

export interface ValidationTargetInput {
  /** `VALIDATION_TARGET_URL` */
  raw: string | undefined;
  /** `VALIDATION_TARGET_ACK` — 대상 호스트와 같아야 한다 */
  ack: string | undefined;
  /** `PRODUCTION_HOSTS` — 쉼표로 구분한 운영 호스트 */
  productionHosts: string | undefined;
  /** 지금 이 인스턴스가 서비스되는 주소 (`PUBLIC_BASE_URL` 등) — 모르면 null */
  selfUrl: string | null;
  /** 지금 이 인스턴스의 배포 단계 */
  tier: DeploymentTier;
}

/** 배포 단계 — 진단·경보 등급이 여기서 갈린다 (정책 4101-③) */
export const DEPLOYMENT_TIERS = ["development", "staging", "production"] as const;
export type DeploymentTier = (typeof DEPLOYMENT_TIERS)[number];

export const DEPLOYMENT_TIER_ENV = "DEPLOY_TIER";

/**
 * 지금 어느 단계에서 도는가 (순수 함수, CTO 정책 4101-③).
 *
 * `NODE_ENV`만으로는 **스테이징을 표현할 수 없습니다** — Node는
 * `production`과 그 외만 압니다. 그래서 `DEPLOY_TIER`를 따로 둡니다.
 *
 * **모르면 `development`로 봅니다.** 반대로 두면(모르면 운영) 개발자
 * 노트북이 운영으로 판정돼 경보가 쏟아지고, 그러면 그 경보 채널 전체가
 * 무시됩니다.
 */
export function resolveDeploymentTier(
  env: Record<string, string | undefined>,
): DeploymentTier {
  const raw = (env[DEPLOYMENT_TIER_ENV] ?? "").trim().toLowerCase();
  if (raw === "staging" || raw === "stage") {
    return "staging";
  }
  if (raw === "production" || raw === "prod") {
    return "production";
  }
  if (raw === "development" || raw === "dev") {
    return "development";
  }
  // `DEPLOY_TIER`가 없으면 예전 방식(NODE_ENV)으로 되돌아간다 — 다만
  // NODE_ENV=production만으로는 스테이징인지 운영인지 가릴 수 없으므로,
  // 그 경우는 운영으로 본다(더 엄격한 쪽).
  return (env.NODE_ENV ?? "").trim().toLowerCase() === "production"
    ? "production"
    : "development";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function isLocalHost(host: string): boolean {
  if (LOCAL_HOSTS.has(host)) {
    return true;
  }
  if (host.endsWith(".local") || host.endsWith(".localhost")) {
    return true;
  }
  // 사설 대역 — 노트북·사내망이다
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/**
 * 검증 대상을 판정한다 (순수 함수, CTO 정책 4101-①).
 *
 * 판정 순서가 곧 위험 순서입니다: **운영을 가리키는 것**이 가장 위험하고,
 * 그다음이 자기 자신, 그다음이 사설망입니다. 확인 누락은 마지막입니다 —
 * 앞의 셋은 확인을 받아도 허용하지 않기 때문입니다.
 */
export function judgeValidationTarget(
  input: ValidationTargetInput,
): ValidationTargetJudgement {
  const raw = (input.raw ?? "").trim();
  if (raw.length === 0) {
    return {
      verdict: "unset",
      url: null,
      host: null,
      usable: false,
      // 미설정은 실패가 아니다 — 아직 정하지 않은 것이다
      detail: "검증 대상이 아직 정해지지 않았습니다.",
      next: `${VALIDATION_TARGET_ENV}에 검증용 환경 주소를 두세요.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      verdict: "invalid",
      url: null,
      host: null,
      usable: false,
      detail: `주소로 읽을 수 없습니다: ${raw}`,
      next: "http(s) 주소를 적어 주세요 (예: https://staging.example.com).",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      verdict: "invalid",
      url: null,
      host: parsed.hostname,
      usable: false,
      detail: `http(s)가 아닙니다: ${parsed.protocol}`,
      next: "http(s) 주소를 적어 주세요.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  const url = parsed.origin;

  // ① 운영을 가리키는가 — **확인을 받아도 허용하지 않는다**
  const productionHosts = (input.productionHosts ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (productionHosts.includes(host)) {
    return {
      verdict: "production",
      url,
      host,
      usable: false,
      detail:
        `${host}는 운영 호스트로 선언돼 있습니다. 검증 스프린트는 실패를 ` +
        "만들려고 하는 기간이고, 그것을 운영에 대고 하는 것은 검증이 아니라 " +
        "사고입니다.",
      next:
        `${PRODUCTION_HOSTS_ENV}에서 이 호스트를 빼거나, ` +
        `${VALIDATION_TARGET_ENV}를 검증용 환경으로 바꾸세요.`,
    };
  }

  // ② 지금 이 인스턴스인가 — 검증 도구와 검증 대상이 같아진다
  if (input.selfUrl !== null) {
    try {
      if (new URL(input.selfUrl).hostname.toLowerCase() === host) {
        return {
          verdict: "self",
          url,
          host,
          usable: false,
          detail:
            "검증 대상이 지금 이 인스턴스와 같습니다 — 자기가 자기를 " +
            "검증하면, 검증하다 죽었을 때 그 사실을 보고할 주체도 함께 " +
            "죽습니다.",
          next: "검증 대상을 별도 환경으로 두세요.",
        };
      }
    } catch {
      // selfUrl을 못 읽는 것은 이 판정을 막을 이유가 아니다
    }
  }

  // ③ 사설망인가 — 운영 키가 개발 기기에서 나간다
  if (isLocalHost(host)) {
    return {
      verdict: "local",
      url,
      host,
      usable: false,
      detail:
        `${host}는 우리 컴퓨터·사설망입니다. 개발자 노트북에서 운영 키로 ` +
        "스모크를 돌리는 것은 검증이 아니라 사고입니다.",
      next: "외부에서 닿는 검증용 환경 주소를 두세요.",
    };
  }

  // ④ 돌려도 된다는 확인이 있는가
  const ack = (input.ack ?? "").trim().toLowerCase();
  if (ack !== host) {
    return {
      verdict: "unacknowledged",
      url,
      host,
      usable: false,
      detail:
        ack.length === 0
          ? `주소는 성립하지만 ${VALIDATION_TARGET_ACK_ENV}가 없습니다 — ` +
            "주소를 적는 것과 그곳에 돈이 나가는 호출을 돌려도 된다고 말하는 " +
            "것은 다른 행동입니다."
          : `${VALIDATION_TARGET_ACK_ENV}(${ack})가 대상 호스트(${host})와 ` +
            "다릅니다 — 대상을 바꾸고 확인을 안 바꾼 것으로 보입니다.",
      next: `${VALIDATION_TARGET_ACK_ENV}=${host}을 설정하세요.`,
    };
  }

  return {
    verdict: "accepted",
    url,
    host,
    usable: true,
    detail: `검증 대상: ${url} (확인됨).`,
    next:
      input.tier === "production"
        ? "이 인스턴스는 운영입니다 — 검증은 대상 환경에서 돌려야 합니다."
        : null,
  };
}

/**
 * 검증 대상 판정을 진단 항목으로 (순수 함수).
 *
 * **미설정을 실패로 만들지 않습니다** — 검증 스프린트를 아직 시작하지 않은
 * 것은 정상 상태입니다. 반대로 **잘못 설정한 것은 실패입니다**: 그건
 * 안 정한 것보다 나쁩니다.
 */
export function validationTargetCheck(judgement: ValidationTargetJudgement): {
  id: string;
  title: string;
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
  next: string | null;
} {
  const status =
    judgement.verdict === "accepted"
      ? "ok"
      : judgement.verdict === "unset"
        ? "ok"
        : judgement.verdict === "unacknowledged"
          ? "warn"
          : "fail";
  return {
    id: "validation-target",
    title: "검증 대상 주소",
    status,
    detail: judgement.detail,
    next: judgement.next,
  };
}
