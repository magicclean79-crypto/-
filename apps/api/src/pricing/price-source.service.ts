import { Injectable, Logger } from "@nestjs/common";
import { judgePriceSource } from "@acos/core";
import type { PriceSourceVerdict } from "@acos/core";

/**
 * 공지 조회 제한 시간.
 *
 * 외부에 매달려 예약 점검 전체가 멈추면 안 됩니다. 시간이 지나면 **못 읽은
 * 것으로 판정**하고(정책 3301-① — "변경 없음"이 아닙니다) 다음 회차에 다시
 * 시도합니다.
 */
export const PRICE_SOURCE_TIMEOUT_MS = 5_000;

/**
 * 외부 가격 공지 어댑터. (TASK-3301, Sprint 33 — CTO 정책 3301-①)
 *
 * `PRICE_SOURCE_URL`에서 가격표를 읽어 `@acos/core`의 순수 판정
 * (`judgePriceSource`)에 넘깁니다. 이 어댑터가 하는 일은 **가져오는 것**뿐이고,
 * 성공·실패의 의미를 정하는 것은 core입니다.
 *
 * 세 가지를 지킵니다:
 *
 * 1. **실패를 삼키지 않습니다** — 네트워크 오류·타임아웃·HTTP 오류를 모두
 *    `error`로 넘깁니다. 빈 목록으로 바꾸면 "변경 없음"이 되어 버립니다
 *    (정책 3301-①이 금지하는 바로 그것입니다).
 * 2. **재시도하지 않습니다** — 예약 점검이 주기적으로 다시 부릅니다. 여기서
 *    재시도하면 실패가 몇 배로 길어지고, 그동안 점검 전체가 멈춥니다.
 * 3. **주소를 숨기지 않습니다** — 공지 주소는 비밀이 아니고, 무엇을 읽으려
 *    했는지 모르면 사람이 확인할 수 없습니다. (키가 필요한 주소라면 헤더로
 *    보내며, 헤더 값은 로그에 남기지 않습니다.)
 */
@Injectable()
export class PriceSourceService {
  private readonly logger = new Logger(PriceSourceService.name);

  /** 설정된 공지 주소 — 없으면 null (미구성은 실패가 아니다) */
  get url(): string | null {
    const raw = process.env.PRICE_SOURCE_URL;
    return raw === undefined || raw.trim() === "" ? null : raw.trim();
  }

  private get timeoutMs(): number {
    const raw = Number(process.env.PRICE_SOURCE_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : PRICE_SOURCE_TIMEOUT_MS;
  }

  /** 공지를 읽고 판정한다 — 실패도 판정 결과의 하나다 */
  async fetch(): Promise<PriceSourceVerdict> {
    const url = this.url;
    if (url === null) {
      return judgePriceSource({ url: null, body: null, error: null });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const token = process.env.PRICE_SOURCE_TOKEN;
      const response = await globalThis.fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          // 토큰이 필요한 공지도 있다 — 값은 어디에도 남기지 않는다
          ...(token !== undefined && token.trim() !== ""
            ? { authorization: `Bearer ${token.trim()}` }
            : {}),
        },
      });
      if (!response.ok) {
        return judgePriceSource({
          url,
          body: null,
          error: `HTTP ${response.status}`,
        });
      }
      // 본문이 JSON이 아니면 **여기서 판단하지 않는다** — core가 "해석할 수
      // 없다"로 판정하도록 원문을 그대로 넘긴다
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return judgePriceSource({ url, body, error: null });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "AbortError"
          ? `${this.timeoutMs}ms 안에 응답이 오지 않았습니다`
          : String(error);
      this.logger.warn(
        `가격 공지를 가져오지 못했습니다 (${url}): ${reason} — ` +
          "변경이 없다는 뜻이 아닙니다 (CTO 정책 3301-①).",
      );
      return judgePriceSource({ url, body: null, error: reason });
    } finally {
      clearTimeout(timer);
    }
  }
}
