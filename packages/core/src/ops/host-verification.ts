/**
 * 운영 호스트 목록 검증. (TASK-4201, Sprint 42 — CTO 정책 4201-①)
 *
 * TASK-4101은 `PRODUCTION_HOSTS`와 대조해 검증 대상이 운영을 가리키는지
 * 막았습니다. 그 보호는 **목록이 정확할 때만** 동작합니다. 그리고 그 목록은
 * 사람이 손으로 적습니다.
 *
 * ## 목록이 낡는 것을 아무도 모릅니다
 *
 * 새 운영 도메인이 붙거나, 도메인이 바뀌거나, 리전이 늘면 목록은 그대로
 * 남습니다. 그리고 **빠진 호스트는 아무 신호도 내지 않습니다** — 검증 대상
 * 판정은 그 주소를 조용히 통과시킬 뿐입니다. 사고가 난 다음에야 "그 호스트가
 * 목록에 없었네요"를 알게 됩니다. 우리가 여러 번 본 모양입니다:
 * **빠진 것은 실패하지 않습니다.**
 *
 * ## 자동으로 채우지 않습니다
 *
 * 가장 쉬운 해법은 관측한 호스트를 목록에 자동으로 넣는 것입니다.
 * **그러면 보호가 스스로 무력해집니다.** 지금까지는 "우리가 몰라서" 운영
 * 주소를 통과시켰다면, 그때부터는 "우리가 자동으로 등록해서" 통과시키게
 * 됩니다 — 게다가 자동 등록은 **검증용 스테이징 호스트까지** 운영으로
 * 올려 버립니다. 그러면 정작 검증 대상이 막힙니다.
 *
 * 그래서 이 파일은 **관측만 하고 말합니다.** 목록에 없는데 실제로 쓰이고
 * 있는 호스트를 찾아 "이것이 운영입니까"라고 묻습니다. 대답은 사람이
 * 합니다.
 */

import type { DeploymentTier } from "./validation-target";

/** 실제로 쓰이고 있다고 관측된 호스트 하나 */
export interface ObservedHost {
  host: string;
  /** 어디서 봤는가 — `PUBLIC_BASE_URL` · `S3_ENDPOINT` · 실행 기록 등 */
  source: string;
  /** 이 관측이 운영 트래픽에서 온 것인가 (설정값 관측이면 false) */
  fromTraffic: boolean;
}

export type HostVerdict =
  /** 목록에 있고 실제로도 쓰인다 */
  | "declared"
  /** 목록에 없는데 쓰이고 있다 — **사람이 판단해야 한다** */
  | "undeclared"
  /**
   * 사설망·노트북이라 **운영 호스트일 수 없다** — 물어볼 것이 없다.
   *
   * 라이브 검증에서 이것 없이 돌렸더니 `localhost`를 두고 "이것이 운영
   * 호스트라면 목록에 넣어 주세요"라고 물었습니다. 그 제안을 따르면
   * 검증 대상 보호가 **모든 로컬 대상을 운영으로 보고 거부**하게 됩니다.
   * 그리고 명백히 틀린 질문을 하는 목록은 곧 아무도 안 읽습니다.
   */
  | "not-applicable"
  /** 목록에 있는데 최근 관측이 없다 — 사라진 것일 수 있다 */
  | "unseen";

export interface HostFinding {
  host: string;
  verdict: HostVerdict;
  sources: string[];
  detail: string;
}

/**
 * 운영 호스트일 수 없는 곳 — 사설망·노트북.
 *
 * `validation-target.ts`의 판정과 같은 규칙입니다. 두 곳에서 다르게 보면
 * "검증 대상으로는 사설망인데 운영 후보로는 올라오는" 상태가 생깁니다.
 */
function isLocalHost(host: string): boolean {
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(host)) {
    return true;
  }
  if (host.endsWith(".local") || host.endsWith(".localhost")) {
    return true;
  }
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

export interface HostVerificationReport {
  findings: HostFinding[];
  /** 선언된 호스트 수 — 0이면 보호가 사실상 꺼져 있다 */
  declared: number;
  /** 목록에 없는데 쓰이는 호스트 */
  undeclared: HostFinding[];
  /** 목록에 있는데 안 보이는 호스트 */
  unseen: HostFinding[];
  /** 이 단계에서 목록을 요구하는가 */
  required: boolean;
  detail: string;
}

/** 쉼표 목록을 호스트 집합으로 (순수 함수) */
export function parseHostList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** 주소에서 호스트만 — 읽을 수 없으면 null */
export function hostOf(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value.length === 0) {
    return null;
  }
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 목록과 관측을 대조한다 (순수 함수, CTO 정책 4201-①).
 *
 * **자동으로 목록을 고치지 않습니다.** 돌려주는 것은 판정뿐이고, 목록을
 * 바꾸는 것은 사람의 일입니다 — 자동으로 채우면 이 보호가 스스로
 * 무력해집니다.
 */
export function verifyProductionHosts(input: {
  declared: string[];
  observed: ObservedHost[];
  tier: DeploymentTier;
}): HostVerificationReport {
  const declared = input.declared.map((host) => host.toLowerCase());
  const declaredSet = new Set(declared);

  const bySource = new Map<string, string[]>();
  for (const row of input.observed) {
    const host = row.host.toLowerCase();
    const list = bySource.get(host) ?? [];
    list.push(row.source);
    bySource.set(host, list);
  }

  const findings: HostFinding[] = [];

  for (const [host, sources] of bySource) {
    if (declaredSet.has(host)) {
      findings.push({
        host,
        verdict: "declared",
        sources,
        detail: `선언된 운영 호스트이며 실제로 쓰이고 있습니다 (${sources.join(" · ")}).`,
      });
      continue;
    }
    if (isLocalHost(host)) {
      // **물어보지 않는다** — 사설망은 운영 호스트일 수 없고, 목록에 넣으면
      // 검증 대상 보호가 모든 로컬 대상을 운영으로 보고 거부한다
      findings.push({
        host,
        verdict: "not-applicable",
        sources,
        detail:
          `${host}는 사설망·로컬 주소라 운영 호스트일 수 없습니다 ` +
          `(${sources.join(" · ")}). 목록에 넣지 마세요 — 넣으면 검증 대상 ` +
          "보호가 모든 로컬 대상을 운영으로 보고 거부합니다.",
      });
      continue;
    }
    findings.push({
      host,
      verdict: "undeclared",
      sources,
      detail:
        `${host}는 쓰이고 있는데 PRODUCTION_HOSTS에 없습니다 ` +
        `(${sources.join(" · ")}). 이것이 운영 호스트라면 검증 대상 보호가 ` +
        "이 주소를 통과시킵니다 — 목록에 넣어 주세요. 운영이 아니라면 " +
        "그대로 두면 됩니다.",
    });
  }

  for (const host of declaredSet) {
    if (!bySource.has(host)) {
      findings.push({
        host,
        verdict: "unseen",
        sources: [],
        // **이것은 실패가 아닙니다** — 관측되지 않았다고 없어진 것은 아니다
        detail:
          `${host}는 목록에 있지만 이번 관측에서는 보이지 않았습니다 — ` +
          "없어졌다는 뜻이 아니라 이 인스턴스가 그 주소를 쓰지 않는다는 " +
          "뜻일 수 있습니다.",
      });
    }
  }

  const undeclared = findings.filter((row) => row.verdict === "undeclared");
  const unseen = findings.filter((row) => row.verdict === "unseen");
  // 개발에서는 목록을 요구하지 않는다 — 노트북에 운영 호스트 목록을 두라고
  // 요구하면 그 경고가 배경 소음이 되고, 그러면 정작 운영의 경고도 안 읽힌다
  const required = input.tier !== "development";

  const parts: string[] = [];
  if (declared.length === 0) {
    parts.push(
      required
        ? "PRODUCTION_HOSTS가 비어 있습니다 — 검증 대상 보호에서 운영 호스트 " +
          "대조가 사실상 꺼져 있습니다."
        : "PRODUCTION_HOSTS가 비어 있습니다 (개발에서는 요구하지 않습니다).",
    );
  } else {
    parts.push(`선언된 운영 호스트 ${declared.length}개.`);
  }
  if (undeclared.length > 0) {
    parts.push(
      `목록에 없는데 쓰이는 호스트 ${undeclared.length}개: ` +
        `${undeclared.map((row) => row.host).join(" · ")}. 이것이 운영이라면 ` +
        "검증 대상 보호가 그 주소를 통과시킵니다 — 목록을 고쳐 주세요. " +
        "자동으로 넣지 않는 이유는 그러면 스테이징까지 운영으로 올라가 " +
        "정작 검증 대상이 막히기 때문입니다.",
    );
  }
  if (unseen.length > 0) {
    parts.push(
      `목록에 있지만 이번에 안 보인 호스트 ${unseen.length}개 — 없어졌다는 ` +
        "뜻은 아닙니다.",
    );
  }
  if (parts.length === 1 && undeclared.length === 0 && declared.length > 0) {
    parts.push("목록과 관측이 일치합니다.");
  }

  return {
    findings,
    declared: declared.length,
    undeclared,
    unseen,
    required,
    detail: parts.join(" "),
  };
}

/**
 * 목록 검증을 진단 항목으로 (순수 함수).
 *
 * **목록이 비어 있는 것과 어긋난 것을 가릅니다.** 비어 있으면 보호가 꺼진
 * 것이고(운영에서는 실패), 어긋나면 사람이 확인할 질문이 생긴 것입니다(주의).
 */
export function hostVerificationCheck(report: HostVerificationReport): {
  id: string;
  title: string;
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
  next: string | null;
} {
  const status = !report.required
    ? "ok"
    : report.declared === 0
      ? "fail"
      : report.undeclared.length > 0
        ? "warn"
        : "ok";
  return {
    id: "production-hosts",
    title: "운영 호스트 목록",
    status,
    detail: report.detail,
    next:
      report.declared === 0 && report.required
        ? "PRODUCTION_HOSTS에 운영 도메인을 쉼표로 나열하세요."
        : report.undeclared.length > 0
          ? `${report.undeclared.map((row) => row.host).join(" · ")}가 운영인지 확인하고, 맞다면 PRODUCTION_HOSTS에 더하세요.`
          : null,
  };
}
