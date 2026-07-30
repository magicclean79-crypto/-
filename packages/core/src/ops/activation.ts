/**
 * 운영 활성화 판정. (TASK-3601, Sprint 36 — CTO 정책 3601-①)
 *
 * ## 왜 세 조건을 따로 세는가
 *
 * TASK-3401·3501을 지나며 "전환이 끝났는가"에 답하는 장치는 갖췄지만, 그
 * 답이 **하나의 초록불**이었습니다. 하나로 뭉친 초록불은 두 가지를 못 합니다:
 *
 * - **무엇이 남았는지** 말하지 못합니다 — 키가 없는 것과 길이 막힌 것과
 *   판정이 빨간 것은 사람이 할 일이 전혀 다릅니다.
 * - **거의 다 됐다**는 착각을 만듭니다 — 셋 중 둘이 되면 초록불이 조금 밝아진
 *   것처럼 보이지만, 실제로는 **여전히 아무것도 전환되지 않은 상태**입니다.
 *
 * 그래서 CTO 정책 3601-①은 완료 조건을 셋으로 못박았습니다:
 *
 * | 조건 | 무엇을 보는가 |
 * | --- | --- |
 * | `credentials` | 골라 놓은 Provider·저장소의 **자격 증명이 실제로 있는가** |
 * | `network` | 그 공식 주소에 **닿는가** (막힘·모호함이 하나도 없는가) |
 * | `cutover` | `/ops/cutover` 판정이 **전부 verified인가** |
 *
 * **셋 중 하나라도 아니면 완료가 아닙니다.** 부분 점수는 없습니다 —
 * 전환은 "조금 됐다"가 존재하지 않는 일이기 때문입니다.
 */

import { validateApiKeyFormat } from "../llm/api-key";
import type { EgressProbe } from "./production-cutover";
import { AWS_S3_OFFICIAL_HOST, judgeEndpointOrigin } from "./production-cutover";

export const ACTIVATION_CONDITIONS = ["credentials", "network", "cutover"] as const;
export type ActivationConditionId = (typeof ACTIVATION_CONDITIONS)[number];

export interface ActivationCondition {
  id: ActivationConditionId;
  title: string;
  /** 이 조건이 충족됐는가 — **모르면 false**(모르는 것을 통과로 세지 않는다) */
  met: boolean;
  detail: string;
  /** 사람이 다음에 할 일 */
  next: string;
}

export interface ActivationReport {
  conditions: ActivationCondition[];
  /** 셋이 모두 충족됐는가 (CTO 정책 3601-①) */
  activated: boolean;
  /** 이 환경에서 활성화를 판정할 이유가 있는가 (정책 3501-①) */
  applicable: boolean;
  environment: string;
  detail: string;
}

export interface ActivationInput {
  env: Record<string, string | undefined>;
  /** 공식 주소 도달 점검 — 비어 있으면 **점검하지 않은 것** */
  egress: EgressProbe[];
  /** `/ops/cutover` 판정 */
  cutover: { ready: boolean; applicable: boolean; environment: string; detail: string };
}

/** 자격 증명 한 칸의 상태 (표시용) */
interface CredentialCheck {
  name: string;
  ok: boolean;
  reason: string;
}

/**
 * 자격 증명 조건.
 *
 * **키 형식만 봅니다** — 키가 유효한지는 실제 호출만이 압니다(그것은
 * `cutover` 조건이 봅니다). 여기서 잡는 것은 "아예 없다 · 플레이스홀더가
 * 그대로다 · 형식이 깨졌다"입니다.
 */
function judgeCredentials(env: ActivationInput["env"]): ActivationCondition {
  const checks: CredentialCheck[] = [];

  const provider = (env.LLM_PROVIDER ?? "mock").trim().toLowerCase();
  const keyEnv: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  if (provider === "mock") {
    checks.push({
      name: "LLM_PROVIDER",
      ok: false,
      reason: "mock입니다 — Provider를 부르지 않습니다.",
    });
  } else if (keyEnv[provider] === undefined) {
    checks.push({
      name: "LLM_PROVIDER",
      ok: false,
      reason: `구현되지 않은 Provider입니다: ${provider}`,
    });
  } else {
    const format = validateApiKeyFormat(provider, env[keyEnv[provider]]);
    checks.push({
      name: keyEnv[provider],
      ok: format.status === "ok",
      reason: format.status === "ok" ? "형식 정상" : format.message,
    });
  }

  const ocr = (env.OCR_PROVIDER ?? "mock").trim().toLowerCase();
  if (ocr !== "google-vision") {
    checks.push({
      name: "OCR_PROVIDER",
      ok: false,
      reason: `${ocr}입니다 — 운영 표준은 google-vision입니다.`,
    });
  } else {
    const format = validateApiKeyFormat("google-vision", env.GOOGLE_VISION_API_KEY);
    checks.push({
      name: "GOOGLE_VISION_API_KEY",
      ok: format.status === "ok",
      reason: format.status === "ok" ? "형식 정상" : format.message,
    });
  }

  // 저장소는 **Amazon S3를 가리킬 때만** 자격 증명을 따진다 —
  // 아직 전환 전이면 그것은 미구성이지 자격 증명 문제가 아니다
  const storage = judgeEndpointOrigin(env.S3_ENDPOINT, [AWS_S3_OFFICIAL_HOST]);
  if (storage.origin !== "official") {
    checks.push({
      name: "S3_ENDPOINT",
      ok: false,
      reason: "Amazon S3를 가리키지 않습니다.",
    });
  } else {
    const access = (env.S3_ACCESS_KEY ?? "").trim();
    const secret = (env.S3_SECRET_KEY ?? "").trim();
    const bad = access === "" || secret === "" || access === "minioadmin";
    checks.push({
      name: "S3_ACCESS_KEY",
      ok: !bad,
      reason: bad ? "비어 있거나 개발 기본값(minioadmin)입니다." : "설정됨",
    });
  }

  const missing = checks.filter((check) => !check.ok);
  return {
    id: "credentials",
    title: "자격 증명",
    met: missing.length === 0,
    detail:
      missing.length === 0
        ? `필요한 자격 증명 ${checks.length}개가 모두 설정돼 있습니다 (형식 기준 — 유효성은 실제 호출이 압니다).`
        : `아직인 것 ${missing.length}개: ` +
          missing.map((check) => `${check.name}(${check.reason})`).join(" · "),
    next:
      missing.length === 0
        ? "추가 조치가 없습니다."
        : `${missing.map((check) => check.name).join(" · ")}를 설정하세요.`,
  };
}

/**
 * 네트워크 조건.
 *
 * **점검하지 않았으면 충족이 아닙니다.** 빈 목록은 "닿는다"가 아니라
 * "모른다"이고, 모르는 것을 통과로 세지 않습니다. 403(`ambiguous`)도
 * 충족이 아닙니다 — 누가 막았는지 모르는 상태로 "길이 열렸다"고 말할 수
 * 없습니다.
 */
function judgeNetwork(input: ActivationInput): ActivationCondition {
  if (input.egress.length === 0) {
    return {
      id: "network",
      title: "네트워크",
      met: false,
      detail:
        "공식 주소 도달 점검 결과가 없습니다 — 점검하지 않은 것을 '닿는다'로 " +
        "세지 않습니다. (Provider가 mock이면 점검할 주소 자체가 없습니다.)",
      next: "실 Provider를 고른 뒤 GET /ops/cutover로 도달 점검을 돌리세요.",
    };
  }

  const blocked = input.egress.filter((probe) => probe.status === "blocked");
  const ambiguous = input.egress.filter((probe) => probe.status === "ambiguous");
  if (blocked.length === 0 && ambiguous.length === 0) {
    return {
      id: "network",
      title: "네트워크",
      met: true,
      detail: `공식 주소 ${input.egress.length}곳에 모두 닿습니다.`,
      next: "추가 조치가 없습니다.",
    };
  }

  const parts: string[] = [];
  if (blocked.length > 0) {
    parts.push(
      `막힘 ${blocked.map((probe) => `${probe.host}(${probe.detail})`).join(", ")}`,
    );
  }
  if (ambiguous.length > 0) {
    parts.push(
      `가릴 수 없음 ${ambiguous.map((probe) => probe.host).join(", ")} — 403이 ` +
        "Provider의 거절인지 프록시인지 모릅니다",
    );
  }
  return {
    id: "network",
    title: "네트워크",
    met: false,
    detail: parts.join(" · "),
    next:
      blocked.length > 0
        ? "방화벽·프록시에서 해당 호스트 아웃바운드를 열어 주세요."
        : "실제 호출 1회로 403의 주인이 누구인지 확인하세요.",
  };
}

/** 전환 판정 조건 — `/ops/cutover`가 전부 `verified`인가 */
function judgeCutoverCondition(input: ActivationInput): ActivationCondition {
  return {
    id: "cutover",
    title: "전환 판정 (pnpm cutover)",
    met: input.cutover.ready,
    detail: input.cutover.detail,
    next: input.cutover.ready
      ? "추가 조치가 없습니다."
      : "pnpm cutover가 알려 주는 항목부터 처리하세요.",
  };
}

/**
 * 운영 활성화를 판정한다 (순수 함수, CTO 정책 3601-①).
 *
 * **세 조건이 모두 충족될 때만 완료입니다.** 둘이 충족된 상태는 "거의 다"가
 * 아니라 여전히 **전환되지 않은 상태**입니다 — 그 사실이 문구에 그대로
 * 드러나야 사람이 남은 하나를 끝까지 처리합니다.
 */
export function judgeActivation(input: ActivationInput): ActivationReport {
  const conditions = [
    judgeCredentials(input.env),
    judgeNetwork(input),
    judgeCutoverCondition(input),
  ];
  const unmet = conditions.filter((condition) => !condition.met);
  const activated = unmet.length === 0;

  const base = activated
    ? "운영 활성화 완료 — 자격 증명 · 네트워크 · 전환 판정 세 조건이 모두 충족됐습니다 (CTO 정책 3601-①)."
    : `운영 활성화 ${conditions.length - unmet.length}/${conditions.length} 조건 충족 — ` +
      `남은 조건: ${unmet.map((condition) => condition.title).join(", ")}. ` +
      "세 조건이 모두 충족될 때만 완료로 인정합니다 (CTO 정책 3601-①).";

  return {
    conditions,
    activated,
    applicable: input.cutover.applicable,
    environment: input.cutover.environment,
    detail: input.cutover.applicable
      ? base
      : `이 환경(${input.cutover.environment})은 활성화 대상이 아닙니다 — 실 Provider ` +
        `전환은 운영·staging에서 수행합니다 (CTO 정책 3501-①). 아래는 참고용입니다: ${base}`,
  };
}
