import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEV_ONLY_OCR_PROVIDERS,
  PRODUCTION_OCR_PROVIDER,
  ROLLOUT_EVIDENCE_WINDOW_DAYS,
  judgeProviderRollout,
} from "./provider-rollout";
import type { RolloutInput } from "./provider-rollout";
import { DEFAULT_OCR_PRICING } from "../ocr/ocr-pricing";

/**
 * 확정된 판정 기준을 고정한다. (TASK-3001 — CTO 결정 2901-①②③)
 *
 * ①은 "완료 판정을 무엇으로 하는가"이고, ②는 "운영 표준 엔진이 무엇인가"이며,
 * ③은 "근거를 언제까지 유효하게 보는가"입니다. 셋 다 **판정의 정의**이므로,
 * 나중에 누가 편의를 위해 느슨하게 만들면 대시보드가 조용히 거짓이 됩니다.
 */

const source = (relative: string) =>
  readFileSync(join(__dirname, relative), "utf8");

const GOOGLE_KEY = `AIza${"c".repeat(31)}`;
const OPENAI_KEY = `sk-${"a".repeat(30)}`;

const base = (overrides: Partial<RolloutInput> = {}): RolloutInput => ({
  env: {},
  llmSuccesses: {},
  visionSuccesses: 0,
  ocrSuccesses: {},
  ...overrides,
});

describe("연결 판정 경계 (TASK-3001, CTO 결정 2901-①②③)", () => {
  describe("완료 판정은 connected 하나다 (결정 2901-①)", () => {
    it("connected만 done이다 — 다른 상태는 어느 것도 완료가 아니다", () => {
      // 완료 기준이 여러 개면 "붙었다"의 뜻이 사람마다 달라진다
      const judged = judgeProviderRollout(
        base({
          env: {
            OPENAI_API_KEY: OPENAI_KEY, // unverified
            ANTHROPIC_API_KEY: "sk-ant-short", // invalid
            OCR_PROVIDER: PRODUCTION_OCR_PROVIDER,
            GOOGLE_VISION_API_KEY: GOOGLE_KEY, // unverified
          },
        }),
      );
      for (const stage of judged.stages) {
        expect(stage.done).toBe(stage.status === "connected");
      }
      expect(judged.summary.connected).toBe(0);
    });

    it("전 단계가 connected일 때만 다음 단계가 없어진다", () => {
      const complete = judgeProviderRollout({
        env: {
          OPENAI_API_KEY: OPENAI_KEY,
          ANTHROPIC_API_KEY: `sk-ant-${"a".repeat(30)}`,
          GEMINI_API_KEY: "g".repeat(30),
          LLM_PROVIDER: "openai",
          OCR_PROVIDER: PRODUCTION_OCR_PROVIDER,
          GOOGLE_VISION_API_KEY: GOOGLE_KEY,
        },
        llmSuccesses: { openai: 1, anthropic: 1, gemini: 1 },
        visionSuccesses: 1,
        ocrSuccesses: { [PRODUCTION_OCR_PROVIDER]: 1 },
      });
      expect(complete.next).toBeNull();
      expect(complete.summary).toEqual({ connected: 5, total: 5 });
    });

    it("설정만으로 완료가 되는 길이 없다 — 근거는 실행 기록뿐이다", () => {
      // 판정 코드가 환경변수만 보고 done을 주면 "설정했으니 붙었다"가 된다
      const code = source("./provider-rollout.ts");
      expect(code).toContain("성공한 실행 기록");
      expect(code).not.toContain("assumeConnected");
      expect(code).not.toContain("forceConnected");
    });
  });

  describe("OCR 운영 표준은 Google Cloud Vision이다 (결정 2901-②)", () => {
    it("표준 엔진 이름이 고정되어 있다", () => {
      expect(PRODUCTION_OCR_PROVIDER).toBe("google-vision");
    });

    it("개발용 엔진은 표준이 아니고, 성공해도 완료로 세지 않는다", () => {
      expect(DEV_ONLY_OCR_PROVIDERS).toEqual(["tesseract"]);
      expect(DEV_ONLY_OCR_PROVIDERS).not.toContain(PRODUCTION_OCR_PROVIDER);

      const judged = judgeProviderRollout(
        base({
          env: { OCR_PROVIDER: "tesseract" },
          ocrSuccesses: { tesseract: 50 },
        }),
      );
      const ocr = judged.stages.find((stage) => stage.stage === "ocr")!;
      expect(ocr.status).toBe("dev-only");
      expect(ocr.done).toBe(false);
    });

    it("표준 엔진의 단가가 가격표에 있다 — 운영 표준인데 미산정이면 안 된다", () => {
      expect(DEFAULT_OCR_PRICING[PRODUCTION_OCR_PROVIDER]).toBeDefined();
      expect(
        DEFAULT_OCR_PRICING[PRODUCTION_OCR_PROVIDER].perUnitUsd,
      ).toBeGreaterThan(0);
    });
  });

  describe("근거 기한은 30일이다 (결정 2901-③)", () => {
    it("값이 30이고 환경변수로 바꿀 수 없다", () => {
      expect(ROLLOUT_EVIDENCE_WINDOW_DAYS).toBe(30);
      const code = source("./provider-rollout.ts");
      expect(code).not.toContain("process.env");
      expect(code).not.toContain("EVIDENCE_WINDOW_ENV");
    });

    it("판정 문구가 기한을 밝힌다 — 무기한 근거처럼 읽히지 않게", () => {
      const judged = judgeProviderRollout(
        base({
          env: { OPENAI_API_KEY: OPENAI_KEY },
          llmSuccesses: { openai: 2 },
        }),
      );
      const openai = judged.stages.find((stage) => stage.stage === "openai")!;
      expect(openai.detail).toContain("최근 30일");
      expect(openai.evidence).toContain("최근 30일");
    });
  });
});
