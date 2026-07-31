/**
 * 운영 스모크 판정. (TASK-3701, Sprint 37 — CTO 정책 3701-②)
 *
 * 지금까지의 판정은 전부 **간접 증거**였습니다: 키 형식이 맞는가, 주소가
 * 공식인가, 그 주소에 TCP가 닿는가, DB에 성공 기록이 있는가. 이 넷을 다
 * 통과해도 답하지 못하는 질문이 하나 남습니다 — **"지금 실제로 부르면
 * 되는가."**
 *
 * 키는 유효하지만 결제가 막혔을 수 있고, 주소는 닿지만 조직 정책이 모델을
 * 거절할 수 있고, 버킷은 존재하지만 쓰기 권한이 없을 수 있습니다. 그 어느
 * 것도 형식·도달·기록으로는 보이지 않습니다. 스모크는 그것을 **한 번 불러서**
 * 확인합니다.
 *
 * ## 왜 자동으로 돌리지 않는가
 *
 * 실 호출은 **돈이 나갑니다.** 매 배포·매 5분마다 도는 스모크는 조용히
 * 청구서를 만듭니다. 그래서 스모크는 사람이 명시적으로 누를 때만 돕니다
 * (결정 1301-①과 같은 판단: 실 Provider 호출은 기본으로 켜지 않는다).
 *
 * ## 성공이 곧 통과가 아니다
 *
 * 스텁을 상대로 200을 받은 것은 **우리 스텁이 살아 있다**는 증거이지 Provider가
 * 붙었다는 증거가 아닙니다. TASK-3401 라이브 검증에서 화면이 스텁 22건을
 * 근거로 "연결됨"이라고 말했던 사고가 정확히 이것이었습니다. 그래서 여기서는
 * 성공을 두 갈래로 나눕니다: 공식 주소를 상대로 한 성공만 `passed`이고,
 * 스텁·로컬을 상대로 한 성공은 `stubbed`입니다 — **통과가 아닙니다.**
 */

import {
  AWS_S3_OFFICIAL_HOST,
  isOfficialCall,
  judgeEndpointOrigin,
} from "./production-cutover";
import type { EgressStatus } from "./production-cutover";

export const SMOKE_TARGETS = ["llm", "ocr", "storage"] as const;
export type SmokeTarget = (typeof SMOKE_TARGETS)[number];

export const SMOKE_TARGET_TITLES: Record<SmokeTarget, string> = {
  llm: "LLM 실제 호출",
  ocr: "OCR(Vision) 실제 호출",
  storage: "S3 실제 쓰기·읽기",
};

export type SmokeStatus =
  /** 공식 주소를 상대로 실제 호출이 성공했다 — 이것만이 통과다 */
  | "passed"
  /** 호출했고 실패했다 */
  | "failed"
  /** 성공했지만 상대가 공식 주소가 아니다 — 스텁이 살아 있다는 증거일 뿐 */
  | "stubbed"
  /** 실 Provider 구성이 아니어서 부르지 않았다 (mock 등) */
  | "skipped";

/** 한 번의 실 호출이 남긴 사실 — 판정은 하지 않는다 */
export interface SmokeProbe {
  target: SmokeTarget;
  provider: string;
  /** 실제로 부른 주소의 기준점 — 모르면 null */
  baseUrl: string | null;
  /** 호출을 시도했는가 (mock 구성이면 false) */
  attempted: boolean;
  /** 호출이 성공했는가 */
  ok: boolean;
  latencyMs: number | null;
  /** 실패 사유 · 건너뛴 사유 */
  detail: string;
  /**
   * 이 주소까지의 **길** 상태 (TASK-3701 라이브 검증에서 추가).
   *
   * 라이브에서 LLM 스모크가 `403 Host not in allowlist`(프록시)로 깨졌는데
   * 화면에는 그냥 **"실패"** 로만 떴습니다. 그걸 본 사람이 가장 먼저 의심하는
   * 것은 **키**이고, 그러면 멀쩡한 키를 재발급하며 시간을 씁니다 —
   * **키가 틀린 것과 길이 막힌 것은 다릅니다**(TASK-3501에서 세운 원칙).
   *
   * 그래서 실패했을 때 도달 점검 결과를 함께 봅니다. 모르면 `null`이며,
   * 모르는 것을 "길은 열려 있었다"로 바꾸지 않습니다.
   */
  pathStatus?: EgressStatus | null;
}

export interface SmokeResult {
  target: SmokeTarget;
  title: string;
  status: SmokeStatus;
  provider: string;
  baseUrl: string | null;
  latencyMs: number | null;
  detail: string;
  /** 사람이 다음에 할 일 */
  next: string;
}

export interface SmokeSummary {
  results: SmokeResult[];
  passed: number;
  total: number;
  /** 셋 다 공식 주소로 통과했는가 — 부분 점수는 없다 */
  ok: boolean;
  detail: string;
}

/**
 * 저장소는 Provider 목록에 없으므로 따로 본다 — 공식 판단 기준은
 * `amazonaws.com`이다. MinIO·s3rver는 프로토콜이 같을 뿐 다른 시스템이다.
 */
function isOfficialStorage(baseUrl: string | null): boolean {
  if (baseUrl === null || baseUrl.trim() === "") {
    return false;
  }
  return judgeEndpointOrigin(baseUrl, [AWS_S3_OFFICIAL_HOST]).origin === "official";
}

/** 실 호출 하나를 판정한다 (순수 함수) */
export function judgeSmokeProbe(probe: SmokeProbe): SmokeResult {
  const title = SMOKE_TARGET_TITLES[probe.target];
  const base = {
    target: probe.target,
    title,
    provider: probe.provider,
    baseUrl: probe.baseUrl,
    latencyMs: probe.latencyMs,
  };

  if (!probe.attempted) {
    return {
      ...base,
      status: "skipped",
      detail: probe.detail,
      next: "실 Provider·실 저장소로 구성한 뒤 다시 돌리세요 — 부르지 않은 것은 통과가 아닙니다.",
    };
  }

  if (!probe.ok) {
    // 길이 막혀 있으면 그 사실을 **먼저** 말한다. 실패는 여전히 실패지만,
    // 이걸 안 적으면 사람은 멀쩡한 키를 먼저 의심한다 (라이브 검증에서 실제로
    // 그럴 뻔했다).
    const blockedPath =
      probe.pathStatus === "blocked" || probe.pathStatus === "ambiguous";
    return {
      ...base,
      status: "failed",
      detail: blockedPath
        ? `${probe.detail} — 이 주소까지의 길이 ` +
          `${probe.pathStatus === "blocked" ? "막혀 있습니다" : "가려지지 않습니다(403)"}. ` +
          "자격 증명 문제로 읽기 전에 길부터 확인하세요 — 키가 틀린 것과 " +
          "길이 막힌 것은 다릅니다."
        : probe.detail,
      next: blockedPath
        ? "방화벽·프록시에서 해당 호스트 아웃바운드를 먼저 여세요 — 길이 막힌 채로는 키를 바꿔도 같은 오류가 납니다."
        : "실패 사유를 그대로 읽으세요 — 형식·도달 점검을 통과하고도 여기서 " +
          "깨지는 것은 결제·권한·모델 접근처럼 실제로 불러야만 보이는 문제입니다.",
    };
  }

  const official =
    probe.target === "storage"
      ? isOfficialStorage(probe.baseUrl)
      : isOfficialCall(probe.provider, probe.baseUrl);

  if (!official) {
    return {
      ...base,
      status: "stubbed",
      detail:
        `${probe.detail} — 다만 상대가 공식 주소가 아닙니다` +
        `(${probe.baseUrl ?? "기록 없음"}). 우리 스텁이 살아 있다는 증거이지 ` +
        "Provider가 붙었다는 증거가 아닙니다.",
      next: "엔드포인트 재정의를 걷어내고 공식 주소로 다시 돌리세요.",
    };
  }

  return {
    ...base,
    status: "passed",
    detail: probe.detail,
    next: "추가 조치가 없습니다.",
  };
}

/**
 * 스모크 전체를 요약한다 (순수 함수).
 *
 * **`ok`는 셋 다 `passed`일 때만 참입니다.** 둘이 통과하고 하나가 스텁이면
 * 그것은 "거의 다"가 아니라 여전히 검증되지 않은 상태입니다.
 */
export function summarizeSmoke(results: SmokeResult[]): SmokeSummary {
  const passed = results.filter((result) => result.status === "passed").length;
  const total = results.length;
  const ok = total > 0 && passed === total;

  const grouped = (status: SmokeStatus): string[] =>
    results.filter((result) => result.status === status).map((result) => result.title);

  const failed = grouped("failed");
  const stubbed = grouped("stubbed");
  const skipped = grouped("skipped");

  const parts: string[] = [`실 호출 ${passed}/${total} 통과.`];
  if (failed.length > 0) {
    parts.push(`실패: ${failed.join(" · ")}.`);
  }
  if (stubbed.length > 0) {
    parts.push(
      `스텁 응답이라 통과로 세지 않음: ${stubbed.join(" · ")} ` +
        "(성공했지만 상대가 공식 주소가 아닙니다).",
    );
  }
  if (skipped.length > 0) {
    parts.push(`구성이 실 Provider가 아니어서 부르지 않음: ${skipped.join(" · ")}.`);
  }
  if (ok) {
    parts.push("세 대상 모두 공식 주소를 상대로 실제 호출에 성공했습니다.");
  }

  return { results, passed, total, ok, detail: parts.join(" ") };
}
