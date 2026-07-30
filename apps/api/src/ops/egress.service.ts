import { Injectable, Logger } from "@nestjs/common";
import {
  AWS_S3_OFFICIAL_HOST,
  GOOGLE_VISION_OFFICIAL_HOST,
  judgeEndpointOrigin,
} from "@acos/core";
import type { EgressProbe } from "@acos/core";

/** 도달 점검 제한 시간 — 여기 매달려 화면이 멈추면 안 된다 */
export const EGRESS_TIMEOUT_MS = 5_000;

/** 점검 결과 캐시 수명 — 방화벽 설정은 초 단위로 바뀌지 않는다 */
export const EGRESS_CACHE_MS = 60_000;

/**
 * 공식 주소 도달 점검. (TASK-3501, Sprint 35 — CTO 지시 2·3)
 *
 * **자격 증명 이전의 조건을 봅니다.** 키를 받아 넣어도 방화벽·프록시가 그
 * 주소를 막고 있으면 전환은 되지 않고, 그때 나오는 오류는 **키 문제처럼**
 * 보입니다. 실제로 이 프로젝트의 검증 환경에서 `api.openai.com`이 프록시에
 * 막혀 있었고(CONNECT 403), 그 사실은 키를 넣어 보기 전에는 드러나지 않았을
 * 것입니다.
 *
 * ## 무엇을 "닿았다"로 보는가
 *
 * **인증 실패(401)는 닿은 것입니다.** 우리가 보려는 것은 "이 주소까지 패킷이
 * 가는가"이고, 키의 유효성은 다른 판정(`/ops/cutover`)이 봅니다. 둘을 섞으면
 * "키가 없어서 401"과 "방화벽이 막아서 실패"가 같은 빨간색이 되고, 그 순간 이
 * 점검은 쓸모가 없어집니다.
 *
 * **403은 모른다고 말합니다.** Provider가 거절한 것일 수도, 중간 프록시가 막은
 * 것일 수도 있습니다 — 라이브 검증에서 `api.openai.com`의 403이 실제로
 * **프록시**였는데 처음 판정은 그것을 "닿음"으로 셌습니다. 구분할 수 없는
 * 것을 구분한 척하지 않습니다.
 *
 * **자격 증명을 보내지 않습니다** — 도달만 보면 되고, 키를 보내면 그 요청이
 * 과금될 수도 있습니다.
 */
@Injectable()
export class EgressService {
  private readonly logger = new Logger(EgressService.name);
  private cache: { at: number; probes: EgressProbe[] } | null = null;

  /** 점검할 공식 주소 — 지금 설정을 따라간다 */
  hosts(): string[] {
    const hosts = new Set<string>();

    const provider = (process.env.LLM_PROVIDER ?? "mock").trim().toLowerCase();
    const official: Record<string, string> = {
      openai: "api.openai.com",
      anthropic: "api.anthropic.com",
      gemini: "generativelanguage.googleapis.com",
    };
    if (official[provider] !== undefined) {
      hosts.add(official[provider]);
    }

    if ((process.env.OCR_PROVIDER ?? "").trim().toLowerCase() === "google-vision") {
      hosts.add(GOOGLE_VISION_OFFICIAL_HOST);
    }

    // 저장소는 **설정된 주소**를 본다 — 공식이 아니면 볼 이유가 없다
    const storage = judgeEndpointOrigin(process.env.S3_ENDPOINT, [
      AWS_S3_OFFICIAL_HOST,
    ]);
    if (storage.origin === "official" && storage.host !== null) {
      hosts.add(storage.host);
    }

    return [...hosts].sort();
  }

  /**
   * 지금 설정이 가리키는 공식 주소에 닿아 본다.
   *
   * 점검할 주소가 없으면 **빈 배열**입니다 — 그것은 "닿는다"도 "막혔다"도
   * 아니고, 판정이 이 정보를 쓰지 않는다는 뜻입니다.
   */
  async probe(options: { force?: boolean } = {}): Promise<EgressProbe[]> {
    const now = Date.now();
    if (
      options.force !== true &&
      this.cache !== null &&
      now - this.cache.at < EGRESS_CACHE_MS
    ) {
      return this.cache.probes;
    }

    const probes = await Promise.all(this.hosts().map((host) => this.reach(host)));
    this.cache = { at: now, probes };
    return probes;
  }

  private async reach(host: string): Promise<EgressProbe> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EGRESS_TIMEOUT_MS);
    try {
      const response = await globalThis.fetch(`https://${host}/`, {
        method: "GET",
        signal: controller.signal,
        // 자격 증명을 보내지 않는다 — 도달만 보면 되고, 키를 보내면 과금될 수 있다
        headers: { accept: "*/*" },
      });
      // 401·404는 **닿은 것**이다 — 우리가 보는 것은 길이지 권한이 아니다.
      // 403만 다르다: 프록시가 막을 때 흔히 쓰는 상태이고, 그때 우리는
      // Provider와 이야기한 적이 없다.
      if (response.status === 403) {
        return {
          host,
          status: "ambiguous",
          reachable: false,
          detail:
            "HTTP 403 — Provider가 거절한 것인지 중간 프록시가 막은 것인지 " +
            "가릴 수 없습니다.",
        };
      }
      return {
        host,
        status: "reachable",
        reachable: true,
        detail: `HTTP ${response.status}`,
      };
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "AbortError"
          ? `${EGRESS_TIMEOUT_MS}ms 안에 응답이 오지 않았습니다`
          : String(error).replace(/^\w*Error:\s*/, "");
      this.logger.warn(
        `공식 주소에 닿지 못했습니다 (${host}): ${reason} — ` +
          "키 문제가 아니라 네트워크 문제일 수 있습니다 (TASK-3501).",
      );
      return { host, status: "blocked", reachable: false, detail: reason };
    } finally {
      clearTimeout(timer);
    }
  }
}
