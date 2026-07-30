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
 *
 * ## Provider별 공지 (TASK-3401 — CTO 결정 3301-⑤)
 *
 * 처음에는 **한 주소가 모든 단가를 담는** 계약이었습니다. 그러면 주소 하나가
 * 죽을 때 **아무 단가도 대조하지 못합니다** — OpenAI 공지가 안 열린다는 이유로
 * Google 단가까지 확인을 못 하는 것은 사실과 맞지 않습니다.
 *
 * 그래서 공지를 **Provider별로 나눕니다**: 주소도 형식도 토큰도 Provider마다
 * 따로이고, **판정도 따로**입니다. 하나가 실패해도 나머지는 읽히고, 실패한
 * 것은 실패한 것으로 남습니다. 전체 상태는 **가장 나쁜 것을 따릅니다** —
 * 셋 중 둘을 읽었다고 "정상"이라 말하면 못 읽은 하나가 다시 사라집니다.
 *
 * 형식(`PRICE_SOURCE_FORMAT_<PROVIDER>`)은 **아는 것만 받습니다.** 모르는
 * 형식은 짐작해서 읽지 않고 **읽지 않았다고 말합니다** — 잘못 읽은 단가는
 * 못 읽은 단가보다 위험합니다.
 */

import type { OcrUnitPrice } from "../ocr/ocr-pricing";
import type { DEFAULT_LLM_PRICING } from "../execution/execution";
import type { LlmPriceInput, OcrPriceInput, PricingTarget } from "./pricing-governance";
import { PROJECT_SCOPED_PATTERN } from "./price-detection";

/** 공지에서 읽어낸 단가 1건 */
export interface PublishedPrice {
  /** 어느 공지에서 읽었는가 (TASK-3401) — 소스를 나눴으므로 근거도 나뉜다 */
  sourceId?: string;
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

/**
 * 아는 공지 형식 (TASK-3401 — CTO 결정 3301-⑤).
 *
 * - `acos` — 우리 계약: `[{target, key, ...}]` 또는 `{prices: [...]}`
 * - `flat` — Provider가 흔히 쓰는 사전형: `{models: {이름: {...}}, engines: {이름: {...}}}`
 * - `csv` — 표로 공개하는 곳도 있다: 첫 줄이 머리글인 쉼표 구분 표
 *   (`target,key,inputPerMillion,outputPerMillion,perUnitUsd,effectiveFrom`)
 *
 * **모르는 형식은 짐작하지 않습니다.** 새 Provider가 또 다른 모양으로 공지하면
 * 어댑터를 하나 더 만드는 것이 답이고, 그전까지는 "읽지 않았다"가 정직한
 * 답입니다 — 짐작으로 읽은 단가는 못 읽은 단가보다 위험합니다.
 */
export const PRICE_SOURCE_FORMATS = ["acos", "flat", "csv"] as const;
export type PriceSourceFormat = (typeof PRICE_SOURCE_FORMATS)[number];

/** 공지 조회 결과 (어댑터가 채운다) */
export interface PriceSourceFetch {
  /** 소스 이름 — Provider별 공지를 가른다 (기본 소스는 `default`) */
  id?: string;
  /** 주소 (표시용 — 비밀이 아니다) */
  url: string | null;
  /** 본문 형식 — 없으면 우리 계약(`acos`)으로 읽는다 */
  format?: PriceSourceFormat;
  /** 받은 본문 — 못 받았으면 null */
  body: unknown;
  /** 네트워크·HTTP 오류 설명 — 정상이면 null */
  error: string | null;
}

// ── Provider별 공지 설정 (TASK-3401 — CTO 결정 3301-⑤) ──────────

/** 기본 소스 이름 — `PRICE_SOURCE_URL` 하나만 쓰던 때와 이어진다 */
export const DEFAULT_PRICE_SOURCE_ID = "default";

const URL_PREFIX = "PRICE_SOURCE_URL_";

/** 공지 소스 1개의 설정 */
export interface PriceSourceConfig {
  /** 소스 이름 (Provider 이름 소문자, 기본 소스는 `default`) */
  id: string;
  url: string;
  format: PriceSourceFormat;
  /** 이 소스의 주소를 담은 환경변수 이름 (표시용) */
  urlEnv: string;
  /** 이 소스의 토큰 환경변수 이름 — 값은 여기 담지 않는다 */
  tokenEnv: string;
  /**
   * 이 소스가 **책임지는 단가 키** (TASK-3501 — CTO 지시 5).
   *
   * `PRICE_SOURCE_KEYS_<PROVIDER>=gpt-4o,gpt-4o-mini`처럼 선언합니다.
   * 선언하면 **그 소스가 죽었을 때 어떤 단가를 확인하지 못했는지** 말할 수
   * 있습니다. 선언하지 않으면 빈 배열이고, 그때는 "무엇을 못 봤는지"까지는
   * 알 수 없습니다 — 모르는 것을 아는 척하지 않습니다.
   */
  keys: string[];
}

export interface PriceSourceResolution {
  sources: PriceSourceConfig[];
  /** 받아들이지 않은 설정 — 조용히 버리지 않는다 */
  rejected: { name: string; reason: string }[];
}

function envSuffix(provider: string): string {
  return provider.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

/** Provider 이름 → 주소 환경변수 이름 */
export function priceSourceUrlEnvName(provider: string): string {
  return `${URL_PREFIX}${envSuffix(provider)}`;
}

/**
 * 환경변수에서 공지 소스 목록을 만든다 (순수 함수).
 *
 * - `PRICE_SOURCE_URL` → 기본 소스(`default`) — 예전 설정이 그대로 돈다
 * - `PRICE_SOURCE_URL_<PROVIDER>` → Provider별 소스
 * - 형식·토큰은 Provider별 값이 있으면 그것을, 없으면 공통 값을 쓴다
 *
 * **프로젝트별 공지는 거부합니다** — 감지 주기와 같은 이유입니다(정책 3301-④):
 * 단가는 Provider와의 계약이지 프로젝트의 속성이 아닙니다. 거부한 설정은
 * 목록으로 남깁니다 — 무시하면 설정한 사람은 적용된 줄 압니다.
 */
export function resolvePriceSources(
  env: Record<string, string | undefined>,
): PriceSourceResolution {
  const rejected: { name: string; reason: string }[] = [];
  const sources: PriceSourceConfig[] = [];

  const readFormat = (
    name: string,
    fallback: PriceSourceFormat,
  ): PriceSourceFormat | null => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") {
      return fallback;
    }
    const value = raw.trim().toLowerCase();
    if ((PRICE_SOURCE_FORMATS as readonly string[]).includes(value)) {
      return value as PriceSourceFormat;
    }
    rejected.push({
      name,
      reason:
        `알 수 없는 공지 형식입니다: ${raw} — 아는 형식은 ` +
        `${PRICE_SOURCE_FORMATS.join("·")}입니다. 짐작해서 읽지 않고 이 소스는 읽지 않습니다 ` +
        "(잘못 읽은 단가는 못 읽은 단가보다 위험합니다).",
    });
    return null;
  };

  const commonFormat = readFormat("PRICE_SOURCE_FORMAT", "acos");

  const add = (id: string, url: string, urlEnv: string, suffix: string | null) => {
    const format =
      suffix === null
        ? commonFormat
        : readFormat(`PRICE_SOURCE_FORMAT_${suffix}`, commonFormat ?? "acos");
    if (format === null) {
      return; // 형식을 모르면 읽지 않는다 — 이유는 rejected에 남았다
    }
    const rawKeys =
      suffix === null ? env.PRICE_SOURCE_KEYS : env[`PRICE_SOURCE_KEYS_${suffix}`];
    sources.push({
      id,
      url,
      format,
      urlEnv,
      tokenEnv:
        suffix !== null && (env[`PRICE_SOURCE_TOKEN_${suffix}`] ?? "").trim() !== ""
          ? `PRICE_SOURCE_TOKEN_${suffix}`
          : "PRICE_SOURCE_TOKEN",
      keys:
        rawKeys === undefined
          ? []
          : rawKeys
              .split(",")
              .map((key) => key.trim())
              .filter((key) => key !== ""),
    });
  };

  const base = env.PRICE_SOURCE_URL;
  if (base !== undefined && base.trim() !== "") {
    add(DEFAULT_PRICE_SOURCE_ID, base.trim(), "PRICE_SOURCE_URL", null);
  }

  for (const name of Object.keys(env).sort()) {
    if (!name.startsWith(URL_PREFIX)) {
      continue;
    }
    const suffix = name.slice(URL_PREFIX.length);
    if (suffix === "") {
      continue;
    }
    if (PROJECT_SCOPED_PATTERN.test(suffix)) {
      rejected.push({
        name,
        reason:
          "프로젝트별 가격 공지는 지원하지 않습니다 (CTO 정책 3301-④와 같은 이유) — " +
          "단가는 Provider와의 계약이지 프로젝트의 속성이 아닙니다. Provider별로 설정하세요.",
      });
      continue;
    }
    const url = env[name];
    if (url === undefined || url.trim() === "") {
      rejected.push({
        name,
        reason: "주소가 비어 있습니다 — 이 소스는 읽지 않습니다(미구성이며 실패가 아닙니다).",
      });
      continue;
    }
    add(suffix.toLowerCase().replace(/_/g, "-"), url.trim(), name, suffix);
  }

  return { sources, rejected };
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
 * `flat` 형식을 우리 계약 모양으로 편다 (TASK-3401 — CTO 결정 3301-⑤).
 *
 * `{models: {"gpt-4o": {input, output}}, engines: {"google-vision": {perUnit}}}`
 *
 * 어댑터가 하는 일은 **모양을 바꾸는 것뿐**입니다 — 무엇이 유효한 단가인지는
 * 형식과 무관하게 `parseEntry` 한 곳에서 판정합니다. 형식마다 검증이 따로면
 * 어떤 형식에서만 통과하는 값이 생기고, 그 차이는 아무도 기억하지 못합니다.
 */
function flattenFlatFormat(body: unknown): unknown[] | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const models = record.models;
  const engines = record.engines;
  if (
    (models === undefined || typeof models !== "object" || models === null) &&
    (engines === undefined || typeof engines !== "object" || engines === null)
  ) {
    return null;
  }

  const entries: unknown[] = [];
  const pick = (row: Record<string, unknown>, ...names: string[]): unknown => {
    for (const name of names) {
      if (row[name] !== undefined) {
        return row[name];
      }
    }
    return undefined;
  };

  for (const [key, raw] of Object.entries(
    (models ?? {}) as Record<string, unknown>,
  )) {
    const row = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
      string,
      unknown
    >;
    entries.push({
      target: "llm",
      key,
      inputPerMillion: pick(row, "inputPerMillion", "input"),
      outputPerMillion: pick(row, "outputPerMillion", "output"),
      effectiveFrom: pick(row, "effectiveFrom", "effective_from"),
    });
  }
  for (const [key, raw] of Object.entries(
    (engines ?? {}) as Record<string, unknown>,
  )) {
    const row = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
      string,
      unknown
    >;
    entries.push({
      target: "ocr",
      key,
      perUnitUsd: pick(row, "perUnitUsd", "perUnit"),
      effectiveFrom: pick(row, "effectiveFrom", "effective_from"),
    });
  }
  return entries;
}

/**
 * `csv` 형식을 우리 계약 모양으로 편다 (TASK-3501 — CTO 지시 5).
 *
 * 첫 줄이 머리글입니다. 값이 빈 칸이면 **없는 것으로** 두고(0으로 읽지
 * 않습니다 — 0은 "무료"라는 뜻이 되어 버립니다), 나머지 판정은 `parseEntry`가
 * 똑같이 합니다.
 */
function flattenCsvFormat(body: unknown): unknown[] | null {
  if (typeof body !== "string") {
    return null;
  }
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length < 2) {
    return null;
  }
  const header = lines[0].split(",").map((cell) => cell.trim());
  if (!header.includes("target") || !header.includes("key")) {
    return null;
  }
  const number = (raw: string | undefined): unknown =>
    raw === undefined || raw === "" ? undefined : Number(raw);

  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const cell = (name: string): string | undefined => {
      const index = header.indexOf(name);
      return index === -1 ? undefined : cells[index];
    };
    return {
      target: cell("target"),
      key: cell("key"),
      inputPerMillion: number(cell("inputPerMillion")),
      outputPerMillion: number(cell("outputPerMillion")),
      perUnitUsd: number(cell("perUnitUsd")),
      effectiveFrom: cell("effectiveFrom"),
    };
  });
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
  const format = fetched.format ?? "acos";
  const list =
    format === "flat"
      ? flattenFlatFormat(body)
      : format === "csv"
        ? flattenCsvFormat(body)
        : Array.isArray(body)
        ? body
        : typeof body === "object" &&
            body !== null &&
            Array.isArray((body as { prices?: unknown }).prices)
          ? (body as { prices: unknown[] }).prices
          : null;

  if (list === null) {
    return {
      status: "unparsable",
      prices: [],
      unparsed: [],
      needsHumanCheck: true,
      detail:
        "가격 공지를 해석할 수 없습니다 — " +
        (format === "flat"
          ? "models·engines 사전이 아닙니다"
          : format === "csv"
            ? "target·key 머리글을 가진 표가 아닙니다"
            : "목록(배열 또는 prices 필드)이 아닙니다") +
        `(형식: ${format}). 형식이 바뀌었는지 확인해 주세요. ${NOT_NO_CHANGE}`,
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

/** 소스 1곳의 판정 결과 */
export interface PriceSourceResult {
  id: string;
  url: string | null;
  format: PriceSourceFormat;
  /** 이 소스가 책임진다고 선언한 단가 키 (TASK-3501) */
  keys?: string[];
  verdict: PriceSourceVerdict;
}

/** 여러 소스를 합친 전체 상태 */
export interface PriceSourceSummary {
  status: PriceSourceStatus;
  needsHumanCheck: boolean;
  /** 모든 소스에서 읽어낸 단가 */
  prices: PublishedPrice[];
  /** 모든 소스에서 못 읽은 항목 */
  unparsed: UnparsedEntry[];
  /** 읽은 소스 수 / 전체 소스 수 */
  read: number;
  total: number;
  /** 읽지 못한 소스 이름 */
  failed: string[];
  /**
   * 읽지 못한 소스가 **책임지던 단가 키** (TASK-3501 — CTO 지시 5).
   *
   * 소스를 나눈 대가로 생긴 빈 곳입니다. 어느 공지가 죽었는지는 알아도
   * **그래서 어떤 단가를 확인하지 못했는지**를 말하지 못하면, 사람은 "그래서
   * 지금 무엇이 위험한가"에 답할 수 없습니다.
   */
  unverifiedKeys: string[];
  detail: string;
}

const STATUS_RANK: Record<PriceSourceStatus, number> = {
  ok: 0,
  unconfigured: 1,
  partial: 2,
  unparsable: 3,
  unreachable: 4,
};

/**
 * 소스별 판정을 하나로 합친다 (순수 함수, TASK-3401 — CTO 결정 3301-⑤).
 *
 * **전체 상태는 가장 나쁜 것을 따릅니다.** 셋 중 둘을 읽었다고 "정상"이라
 * 말하면 못 읽은 하나가 조용히 사라집니다 — `partial`을 따로 둔 것과 같은
 * 이유이고, 이번에는 그 단위가 줄이 아니라 **소스**입니다.
 *
 * 읽은 단가는 **버리지 않고 그대로 씁니다**: 한 곳이 죽었다고 나머지 대조를
 * 멈추면, 소스를 나눈 이유가 없어집니다.
 */
export function summarizePriceSources(
  results: PriceSourceResult[],
): PriceSourceSummary {
  if (results.length === 0) {
    return {
      status: "unconfigured",
      needsHumanCheck: true,
      prices: [],
      unparsed: [],
      read: 0,
      total: 0,
      failed: [],
      unverifiedKeys: [],
      detail:
        "가격 공지 주소가 하나도 설정되지 않았습니다 (PRICE_SOURCE_URL 또는 " +
        "PRICE_SOURCE_URL_<PROVIDER>) — 미구성이며 실패가 아닙니다. 공지 대조 없이는 " +
        "Provider의 단가 변경을 우리 기록만으로 알 수 없습니다.",
    };
  }

  const worst = results.reduce((acc, row) =>
    STATUS_RANK[row.verdict.status] > STATUS_RANK[acc.verdict.status] ? row : acc,
  );
  const failed = results
    .filter((row) => row.verdict.status !== "ok")
    .map((row) => `${row.id}(${row.verdict.status})`);
  const read = results.filter((row) => row.verdict.status === "ok").length;

  const missingKeys = [
    ...new Set(
      results
        .filter((row) => row.verdict.status !== "ok")
        .flatMap((row) => row.keys ?? []),
    ),
  ].sort();
  const keyNote =
    missingKeys.length > 0
      ? ` 그래서 확인하지 못한 단가: ${missingKeys.join(", ")}.`
      : "";
  const head =
    results.length === 1
      ? worst.verdict.detail + keyNote
      : `가격 공지 ${results.length}곳 중 ${read}곳을 읽었습니다.` +
        (failed.length > 0
          ? ` 읽지 못한 곳: ${failed.join(", ")}. ${worst.verdict.detail}${keyNote}`
          : "");

  return {
    status: worst.verdict.status,
    needsHumanCheck: results.some((row) => row.verdict.needsHumanCheck),
    // 어느 공지에서 온 단가인지 잃지 않는다 — 제안의 근거에 그대로 남는다
    prices: results.flatMap((row) =>
      row.verdict.prices.map((price) => ({ ...price, sourceId: row.id })),
    ),
    unparsed: results.flatMap((row) => row.verdict.unparsed),
    read,
    total: results.length,
    failed: results
      .filter((row) => row.verdict.status !== "ok")
      .map((row) => row.id),
    // 죽은 소스가 책임지던 키 — 선언하지 않은 소스는 여기에 아무것도 못 넣는다
    unverifiedKeys: [
      ...new Set(
        results
          .filter((row) => row.verdict.status !== "ok")
          .flatMap((row) => row.keys ?? []),
      ),
    ].sort(),
    detail: head,
  };
}

/** 공지와 우리 가격표의 차이 1건 */
export interface PublishedPriceChange {
  /** 어느 공지가 알렸는가 (TASK-3401) */
  sourceId: string;
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
        sourceId: entry.sourceId ?? DEFAULT_PRICE_SOURCE_ID,
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
      sourceId: entry.sourceId ?? DEFAULT_PRICE_SOURCE_ID,
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
