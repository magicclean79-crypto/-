/**
 * 외부 가격 공지. (TASK-3301, Sprint 33 — CTO 정책 3301-①)
 *
 * TASK-3201의 감지는 **우리 기록과 우리 가격표의 불일치**까지만 볼 수
 * 있었습니다. Provider가 단가를 올린 사실 자체는 우리 기록 어디에도 없기
 * 때문입니다. 이 파일은 그 빈 곳을 채웁니다 — **외부 공지를 읽어** 우리
 * 가격표와 대조합니다.
 *
 * ## 파싱 실패는 "변경 없음"이 아닙니다 (정책 3301-①)
 *
 * 이것이 이 파일의 전부입니다. 공지를 못 읽었을 때 조용히 지나가면:
 *
 * - 화면은 "변경 없음"으로 보이고
 * - 사람은 확인했다고 믿고
 * - 단가는 **낡은 채로 계속 돈이 나갑니다.**
 *
 * 못 읽은 것과 바뀐 것이 없는 것은 **완전히 다른 사실**입니다. 그래서 실패는
 * 언제나 **경고를 만들고 사람의 확인을 요구합니다.** 자동화가 스스로 "괜찮다"고
 * 판단하는 경로를 두지 않습니다.
 *
 * ## 실패의 종류를 가릅니다
 *
 * | 상태 | 뜻 | 사람이 할 일 |
 * | --- | --- | --- |
 * | `ok` | 읽고 해석했다 | 대조 결과를 확인한다 |
 * | `unconfigured` | 공지 주소가 없다 — **실패가 아니다** | 붙일지 결정한다 |
 * | `unreachable` | 주소는 있는데 닿지 못했다 | 주소·네트워크를 확인한다 |
 * | `unparsable` | 받았는데 해석할 수 없다 | **형식이 바뀌었는지** 확인한다 |
 * | `partial` | 일부만 해석했다 | 못 읽은 항목을 직접 확인한다 |
 *
 * `partial`을 따로 두는 이유: 열 줄 중 아홉을 읽었다고 "성공"이라 말하면 못 읽은
 * 한 줄이 조용히 사라집니다. 읽은 것은 쓰고, **못 읽은 것은 말합니다.**
 */

import type { OcrUnitPrice } from "../ocr/ocr-pricing";
import type { DEFAULT_LLM_PRICING } from "../execution/execution";
import type { LlmPriceInput, OcrPriceInput, PricingTarget } from "./pricing-governance";

/** 공지에서 읽어낸 단가 1건 */
export interface PublishedPrice {
  target: PricingTarget;
  /** LLM은 모델 이름, OCR은 엔진 이름 */
  key: string;
  price: LlmPriceInput | OcrPriceInput;
  /** 공지가 밝힌 발효 시각 (ISO) — 없으면 null */
  effectiveFrom: string | null;
}

/** 해석하지 못한 줄 — 버리지 않고 사실로 남긴다 */
export interface UnparsedEntry {
  /** 몇 번째 줄인가 (사람이 원문에서 찾을 수 있게) */
  index: number;
  reason: string;
}

export type PriceSourceStatus =
  | "ok"
  | "partial"
  | "unparsable"
  | "unreachable"
  | "unconfigured";

/** 공지 조회 결과 (어댑터가 채운다) */
export interface PriceSourceFetch {
  /** 주소 (표시용 — 비밀이 아니다) */
  url: string | null;
  /** 받은 본문 — 못 받았으면 null */
  body: unknown;
  /** 네트워크·HTTP 오류 설명 — 정상이면 null */
  error: string | null;
}

export interface PriceSourceVerdict {
  status: PriceSourceStatus;
  prices: PublishedPrice[];
  unparsed: UnparsedEntry[];
  /**
   * 사람의 확인이 필요한가 (정책 3301-①).
   *
   * **`ok`가 아니면 언제나 true입니다** — `unconfigured`조차 "붙일지 결정"이라는
   * 확인이 필요합니다. 다만 그것은 실패가 아니므로 경보 수준이 다릅니다.
   */
  needsHumanCheck: boolean;
  detail: string;
}

/** 공지 한 줄을 해석한다 — 못 읽으면 이유를 돌려준다 */
function parseEntry(
  raw: unknown,
  index: number,
): { price: PublishedPrice } | { unparsed: UnparsedEntry } {
  if (typeof raw !== "object" || raw === null) {
    return { unparsed: { index, reason: "항목이 객체가 아닙니다." } };
  }
  const entry = raw as Record<string, unknown>;
  const target = entry.target;
  if (target !== "llm" && target !== "ocr") {
    return {
      unparsed: { index, reason: `target이 llm·ocr가 아닙니다: ${String(target)}` },
    };
  }
  const key = typeof entry.key === "string" ? entry.key.trim() : "";
  if (key === "") {
    return { unparsed: { index, reason: "key(모델·엔진 이름)가 없습니다." } };
  }

  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;

  if (target === "llm") {
    if (!finite(entry.inputPerMillion) || !finite(entry.outputPerMillion)) {
      return {
        unparsed: {
          index,
          reason: `${key}: inputPerMillion·outputPerMillion이 0 이상의 숫자가 아닙니다.`,
        },
      };
    }
  } else if (!finite(entry.perUnitUsd)) {
    return {
      unparsed: {
        index,
        reason: `${key}: perUnitUsd가 0 이상의 숫자가 아닙니다.`,
      },
    };
  }

  // 발효 시각은 **있으면** 쓴다. 해석할 수 없으면 그 사실만 남기고 null로 둔다 —
  // 잘못 읽은 시각으로 예약하면 엉뚱한 날 단가가 바뀐다
  const rawFrom = entry.effectiveFrom;
  const effectiveFrom =
    typeof rawFrom === "string" && !Number.isNaN(new Date(rawFrom).getTime())
      ? new Date(rawFrom).toISOString()
      : null;

  return {
    price: {
      target,
      key,
      price:
        target === "llm"
          ? {
              inputPerMillion: entry.inputPerMillion as number,
              outputPerMillion: entry.outputPerMillion as number,
            }
          : { perUnitUsd: entry.perUnitUsd as number },
      effectiveFrom,
    },
  };
}

/**
 * 조회 결과를 판정한다 (순수 함수).
 *
 * **실패를 "변경 없음"으로 바꾸지 않습니다** (정책 3301-①). 어떤 실패든
 * `needsHumanCheck: true`이고, 문구가 **무엇을 못 했는지**와 **그것이 변경
 * 없음을 뜻하지 않는다**는 사실을 함께 말합니다.
 */
export function judgePriceSource(fetched: PriceSourceFetch): PriceSourceVerdict {
  const NOT_NO_CHANGE =
    "공지를 읽지 못한 것은 단가가 그대로라는 뜻이 아닙니다 — 사람이 직접 확인해 주세요 (CTO 정책 3301-①).";

  if (fetched.url === null || fetched.url.trim() === "") {
    return {
      status: "unconfigured",
      prices: [],
      unparsed: [],
      // 미구성도 확인이 필요하다 — 다만 **실패는 아니다**
      needsHumanCheck: true,
      detail:
        "가격 공지 주소가 설정되지 않았습니다 (PRICE_SOURCE_URL) — 미구성이며 실패가 아닙니다. " +
        "공지 대조 없이는 Provider의 단가 변경을 우리 기록만으로 알 수 없습니다.",
    };
  }

  if (fetched.error !== null) {
    return {
      status: "unreachable",
      prices: [],
      unparsed: [],
      needsHumanCheck: true,
      detail: `가격 공지를 가져오지 못했습니다: ${fetched.error}. ${NOT_NO_CHANGE}`,
    };
  }

  const body = fetched.body;
  const list = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null && Array.isArray((body as { prices?: unknown }).prices)
      ? ((body as { prices: unknown[] }).prices)
      : null;

  if (list === null) {
    return {
      status: "unparsable",
      prices: [],
      unparsed: [],
      needsHumanCheck: true,
      detail:
        "가격 공지를 해석할 수 없습니다 — 목록(배열 또는 prices 필드)이 아닙니다. " +
        `형식이 바뀌었는지 확인해 주세요. ${NOT_NO_CHANGE}`,
    };
  }

  const prices: PublishedPrice[] = [];
  const unparsed: UnparsedEntry[] = [];
  for (const [index, raw] of list.entries()) {
    const parsed = parseEntry(raw, index);
    if ("price" in parsed) {
      prices.push(parsed.price);
    } else {
      unparsed.push(parsed.unparsed);
    }
  }

  if (prices.length === 0 && unparsed.length > 0) {
    return {
      status: "unparsable",
      prices: [],
      unparsed,
      needsHumanCheck: true,
      detail:
        `가격 공지 ${unparsed.length}건을 모두 해석하지 못했습니다. ${NOT_NO_CHANGE}`,
    };
  }

  if (unparsed.length > 0) {
    // 읽은 것은 쓰고, 못 읽은 것은 말한다 — 아홉을 읽었다고 "성공"이라 하면
    // 못 읽은 하나가 조용히 사라진다
    return {
      status: "partial",
      prices,
      unparsed,
      needsHumanCheck: true,
      detail:
        `가격 공지 ${prices.length}건을 읽었고 ${unparsed.length}건은 해석하지 못했습니다. ` +
        `못 읽은 항목은 단가가 그대로라는 뜻이 아닙니다 — 직접 확인해 주세요 (CTO 정책 3301-①).`,
    };
  }

  return {
    status: "ok",
    prices,
    unparsed: [],
    needsHumanCheck: false,
    detail: `가격 공지 ${prices.length}건을 읽었습니다.`,
  };
}

/** 공지와 우리 가격표의 차이 1건 */
export interface PublishedPriceChange {
  target: PricingTarget;
  key: string;
  published: LlmPriceInput | OcrPriceInput;
  /** 우리 가격표 — 없던 항목이면 null */
  current: LlmPriceInput | OcrPriceInput | null;
  /** 공지가 밝힌 발효 시각 (있으면 그대로 예약에 쓸 수 있다) */
  effectiveFrom: string | null;
  reason: string;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

/**
 * 공지와 지금 가격표를 대조한다 (순수 함수).
 *
 * 여기서 나오는 차이는 **진짜 "Provider가 단가를 바꿨다"**입니다 — 우리 기록의
 * 불일치(TASK-3201)와 성격이 다릅니다. 그래서 제안의 출처를 `published`로
 * 따로 둡니다: 같은 "자동 감지"라도 근거가 다르면 사람이 확인할 것도 다릅니다.
 */
export function comparePublishedPrices(input: {
  published: PublishedPrice[];
  effective: {
    llm: typeof DEFAULT_LLM_PRICING;
    ocr: Record<string, OcrUnitPrice>;
  };
}): PublishedPriceChange[] {
  const changes: PublishedPriceChange[] = [];

  for (const entry of input.published) {
    if (entry.target === "llm") {
      const price = entry.price as LlmPriceInput;
      const current = input.effective.llm[entry.key];
      if (
        current !== undefined &&
        same(current.inputPerMillion, price.inputPerMillion) &&
        same(current.outputPerMillion, price.outputPerMillion)
      ) {
        continue;
      }
      changes.push({
        target: "llm",
        key: entry.key,
        published: price,
        current:
          current === undefined
            ? null
            : {
                inputPerMillion: current.inputPerMillion,
                outputPerMillion: current.outputPerMillion,
              },
        effectiveFrom: entry.effectiveFrom,
        reason:
          `가격 공지가 ${entry.key} 단가를 입력 $${price.inputPerMillion}/1M · ` +
          `출력 $${price.outputPerMillion}/1M로 알립니다 ` +
          (current === undefined
            ? "(우리 가격표에 없던 항목입니다)"
            : `(우리 가격표는 입력 $${current.inputPerMillion}/1M · 출력 $${current.outputPerMillion}/1M)`) +
          (entry.effectiveFrom === null
            ? ". 공지에 발효 시각이 없습니다 — 적용 시각은 사람이 정합니다."
            : `. 공지 발효 시각: ${entry.effectiveFrom}`),
      });
      continue;
    }

    const price = entry.price as OcrPriceInput;
    const current = input.effective.ocr[entry.key];
    if (current !== undefined && same(current.perUnitUsd, price.perUnitUsd)) {
      continue;
    }
    changes.push({
      target: "ocr",
      key: entry.key,
      published: price,
      current: current === undefined ? null : { perUnitUsd: current.perUnitUsd },
      effectiveFrom: entry.effectiveFrom,
      reason:
        `가격 공지가 ${entry.key} 단가를 단위당 $${price.perUnitUsd}로 알립니다 ` +
        (current === undefined
          ? "(우리 가격표에 없던 항목입니다)"
          : `(우리 가격표는 $${current.perUnitUsd})`) +
        (entry.effectiveFrom === null
          ? ". 공지에 발효 시각이 없습니다 — 적용 시각은 사람이 정합니다."
          : `. 공지 발효 시각: ${entry.effectiveFrom}`),
    });
  }

  return changes.sort(
    (a, b) => a.target.localeCompare(b.target) || a.key.localeCompare(b.key),
  );
}
