import { Logger } from "@nestjs/common";
import type { OcrProvider, OcrRecognition } from "@acos/core";

/** 공식 엔드포인트 — 바꿀 이유가 없으면 이 값을 씁니다 */
export const GOOGLE_VISION_DEFAULT_ENDPOINT =
  "https://vision.googleapis.com/v1/images:annotate";

/** 요청 1건의 상한 — 이미지 1장, 텍스트 감지 1종 */
const FEATURE = "TEXT_DETECTION";

/** HTTP 호출 함수 (Port) — 테스트·스테이징 스텁으로 갈아 끼운다 */
export type GoogleVisionFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text: () => Promise<string> }>;

export interface GoogleVisionOcrOptions {
  apiKey: string;
  /** 기본은 공식 엔드포인트 */
  endpoint?: string;
  fetchFn?: GoogleVisionFetch;
  /** 언어 힌트 (`ko,en`) — 없으면 Google이 추론한다 */
  languageHints?: string[];
  timeoutMs?: number;
}

/**
 * Google Cloud Vision 기반 OCR Provider. (TASK-2901, Sprint 29 —
 * CTO 결정 2801-⑤의 마지막 단계)
 *
 * 지금까지 운영에서 쓸 수 있는 OCR 엔진이 **없었습니다.** `mock`은 글자를
 * 읽지 않고 지어내며(그 텍스트로 조립된 상품은 사실이 아닙니다), `tesseract`는
 * 개발용 선택 엔진입니다(결정 2401-⑤). 이 어댑터가 그 자리를 채웁니다.
 *
 * 설계에서 신경 쓴 것 셋:
 *
 * ① **신뢰도를 지어내지 않습니다.** Google의 텍스트 감지는 응답에 따라
 *    신뢰도를 주지 않습니다. 없으면 `null`로 둡니다 — 1.0으로 채우면
 *    "확신한다"는 거짓이고, 0으로 채우면 실패처럼 읽힙니다.
 * ② **오류를 한 덩어리로 뭉치지 않습니다.** 키 문제(401·403)·할당량(429)·
 *    Google 장애(5xx)·이미지 문제는 **사람이 할 일이 전혀 다릅니다.** 같은
 *    "OCR 실패"로 적으면 어디를 봐야 할지 알 수 없습니다.
 * ③ **키를 어디에도 남기지 않습니다.** URL 쿼리에 키가 실리므로 로그·오류
 *    문구에는 URL을 그대로 쓰지 않고 엔드포인트만 적습니다.
 *
 * 재시도는 하지 않습니다 — `OcrExecutionService`가 이미 지수 백오프로
 * 재시도합니다. 여기서 또 하면 재시도 횟수가 곱해집니다.
 */
export class GoogleVisionOcrProvider implements OcrProvider {
  readonly name = "google-vision";

  private readonly logger = new Logger(GoogleVisionOcrProvider.name);
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchFn: GoogleVisionFetch;
  private readonly languageHints: string[];
  private readonly timeoutMs: number;

  constructor(options: GoogleVisionOcrOptions) {
    const key = options.apiKey?.trim() ?? "";
    if (key.length === 0) {
      // 키 없이 만들면 첫 호출에서 실패하고, 그때는 이미 이미지가 올라간 뒤다
      throw new Error(
        "GOOGLE_VISION_API_KEY가 없습니다 — google-vision OCR을 쓰려면 키가 필요합니다.",
      );
    }
    this.apiKey = key;
    this.endpoint = options.endpoint?.trim() || GOOGLE_VISION_DEFAULT_ENDPOINT;
    this.fetchFn =
      options.fetchFn ??
      (async (url, init) => {
        const response = await fetch(url, init);
        return { status: response.status, text: () => response.text() };
      });
    this.languageHints = options.languageHints ?? [];
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  /** 표시용 — 키는 절대 포함하지 않는다 */
  describe(): string {
    return `google-vision (${this.endpoint})`;
  }

  async recognize(
    image: Uint8Array,
    mimeType: string,
  ): Promise<OcrRecognition> {
    const body = JSON.stringify({
      requests: [
        {
          image: { content: Buffer.from(image).toString("base64") },
          features: [{ type: FEATURE }],
          ...(this.languageHints.length > 0
            ? { imageContext: { languageHints: this.languageHints } }
            : {}),
        },
      ],
    });

    const started = Date.now();
    let response: { status: number; text: () => Promise<string> };
    try {
      response = await this.withTimeout(
        this.fetchFn(`${this.endpoint}?key=${encodeURIComponent(this.apiKey)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      );
    } catch (error) {
      // 네트워크 실패와 Google이 답을 준 실패는 다르다 — 문구에서 구분한다.
      // 원인을 cause로 달아 둔다: 문구만 남기면 스택이 끊겨 어디서 끊겼는지 모른다
      throw new Error(
        `Google Cloud Vision에 연결할 수 없습니다 (${this.endpoint}): ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }

    const raw = await response.text();
    if (response.status !== 200) {
      throw new Error(this.describeHttpError(response.status, raw));
    }

    const parsed = this.parse(raw, mimeType);
    this.logger.log(
      `google-vision OCR ${parsed.text.length}자 · ${Date.now() - started}ms` +
        (parsed.confidence === null
          ? " · 신뢰도 미제공"
          : ` · 신뢰도 ${parsed.confidence}`),
    );
    return parsed;
  }

  /**
   * 응답을 엄격하게 읽는다.
   *
   * **글자를 못 찾은 것과 응답을 못 읽은 것은 다릅니다.** 빈 이미지는 정상
   * 결과(텍스트 없음)이고, 형식이 다른 응답은 오류입니다 — 후자를 빈 텍스트로
   * 넘기면 OCR이 성공했다고 기록되고 상품이 빈 재료로 조립됩니다.
   */
  private parse(raw: string, mimeType: string): OcrRecognition {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(
        "Google Cloud Vision 응답을 JSON으로 읽을 수 없습니다 — 엔드포인트 설정을 확인하세요.",
      );
    }

    const responses = (payload as { responses?: unknown }).responses;
    if (!Array.isArray(responses) || responses.length === 0) {
      throw new Error(
        "Google Cloud Vision 응답에 responses가 없습니다 — 계약이 바뀌었거나 다른 서버입니다.",
      );
    }
    const first = responses[0] as {
      error?: { message?: string; status?: string };
      fullTextAnnotation?: { text?: unknown; pages?: unknown };
      textAnnotations?: unknown;
    };

    // 200인데 본문에 error가 들어오는 경우가 있다 — 성공으로 세면 안 된다
    if (first.error) {
      throw new Error(
        `Google Cloud Vision이 오류를 반환했습니다: ${
          first.error.message ?? first.error.status ?? "원인 불명"
        }`,
      );
    }

    const annotation = first.fullTextAnnotation;
    if (annotation === undefined) {
      // 글자가 없는 이미지 — 실패가 아니다
      return {
        text: "",
        confidence: null,
        raw: { engine: this.name, mimeType, empty: true },
      };
    }
    if (typeof annotation.text !== "string") {
      throw new Error(
        "Google Cloud Vision 응답의 fullTextAnnotation.text가 문자열이 아닙니다.",
      );
    }

    return {
      text: annotation.text.trim(),
      confidence: averagePageConfidence(annotation.pages),
      raw: {
        engine: this.name,
        mimeType,
        endpoint: this.endpoint, // 키는 포함하지 않는다
        response: first,
      },
    };
  }

  /** 상태 코드마다 **사람이 할 일**을 적는다 */
  private describeHttpError(status: number, raw: string): string {
    const detail = extractGoogleMessage(raw);
    if (status === 400) {
      return `Google Cloud Vision이 요청을 거절했습니다 (400) — 이미지 형식·크기를 확인하세요: ${detail}`;
    }
    if (status === 401 || status === 403) {
      return (
        `Google Cloud Vision 인증 실패 (${status}) — GOOGLE_VISION_API_KEY가 유효하지 않거나 ` +
        `Cloud Vision API가 사용 설정되지 않았습니다: ${detail}`
      );
    }
    if (status === 429) {
      return `Google Cloud Vision 할당량 초과 (429) — 잠시 후 다시 시도하거나 한도를 올리세요: ${detail}`;
    }
    if (status >= 500) {
      return `Google Cloud Vision 장애 (${status}) — 우리 설정 문제가 아닙니다: ${detail}`;
    }
    return `Google Cloud Vision 호출 실패 (${status}): ${detail}`;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${this.timeoutMs}ms 안에 응답이 없었습니다`)),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

/**
 * 페이지 신뢰도의 평균 — **없으면 `null`**.
 *
 * 지어내지 않습니다. 평균 신뢰도 계산(ProductObjectBuilder)이 이미 null을
 * 제외하므로, 모른다는 사실이 뒤까지 그대로 전달됩니다.
 */
export function averagePageConfidence(pages: unknown): number | null {
  if (!Array.isArray(pages)) {
    return null;
  }
  const values = pages
    .map((page) => (page as { confidence?: unknown }).confidence)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    );
  if (values.length === 0) {
    return null;
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(Math.max(0, Math.min(1, average)).toFixed(4));
}

/** Google 오류 본문에서 메시지만 뽑는다 — 키가 실린 URL은 쓰지 않는다 */
function extractGoogleMessage(raw: string): string {
  try {
    const payload = JSON.parse(raw) as {
      error?: { message?: string; status?: string };
    };
    return payload.error?.message ?? payload.error?.status ?? "본문 없음";
  } catch {
    const trimmed = raw.trim();
    return trimmed.length === 0
      ? "본문 없음"
      : trimmed.slice(0, 200).replace(/\s+/g, " ");
  }
}
