import {
  DEV_ONLY_OCR_PROVIDERS,
  ROLLOUT_EVIDENCE_WINDOW_DAYS,
  PRODUCTION_OCR_PROVIDER,
  PROVIDER_ROLLOUT_ORDER,
  judgeProviderRollout,
  mockStages,
} from "./provider-rollout";
import type { RolloutInput, ProviderRolloutStage } from "./provider-rollout";

const OPENAI_KEY = `sk-${"a".repeat(30)}`;
const ANTHROPIC_KEY = `sk-ant-${"a".repeat(30)}`;
const GEMINI_KEY = "b".repeat(30);
const GOOGLE_KEY = `AIza${"c".repeat(31)}`;

/** 전부 미구성인 기본 입력 */
const base = (overrides: Partial<RolloutInput> = {}): RolloutInput => ({
  env: {},
  llmSuccesses: {},
  visionSuccesses: 0,
  ocrSuccesses: {},
  ...overrides,
});

const stageOf = (
  input: RolloutInput,
  stage: ProviderRolloutStage,
) =>
  judgeProviderRollout(input).stages.find((view) => view.stage === stage)!;

describe("Provider 연결 순서 (TASK-2901, CTO 결정 2801-⑤)", () => {
  it("근거 기한은 고정값이다 — 환경변수로 늘릴 수 없다", () => {
    // 열어 두면 "일단 길게 잡아 두는" 우회가 생기고, 오래전에 끊긴 연결이
    // 계속 초록으로 남는다
    expect(ROLLOUT_EVIDENCE_WINDOW_DAYS).toBe(30);
  });

  it("확정된 순서를 값으로 고정한다", () => {
    // 순서가 코드에 없으면 "다음에 무엇을 붙이는가"에 아무도 답할 수 없다
    expect([...PROVIDER_ROLLOUT_ORDER]).toEqual([
      "openai",
      "anthropic",
      "gemini",
      "vision",
      "ocr",
    ]);
  });

  it("판정에도 그 순서가 그대로 담긴다", () => {
    const judged = judgeProviderRollout(base());
    expect(judged.stages.map((view) => view.stage)).toEqual([
      ...PROVIDER_ROLLOUT_ORDER,
    ]);
    expect(judged.stages.map((view) => view.order)).toEqual([1, 2, 3, 4, 5]);
  });

  describe("미구성과 실패와 모르는 것을 가른다", () => {
    it("키가 없으면 미구성이다 — 실패가 아니다", () => {
      const view = stageOf(base(), "openai");
      expect(view.status).toBe("not-configured");
      expect(view.detail).toContain("실패가 아닙니다");
      expect(view.done).toBe(false);
    });

    it("형식이 틀리면 invalid이고 값은 노출하지 않는다", () => {
      const view = stageOf(
        base({ env: { OPENAI_API_KEY: "sk-your-api-key-xxxx" } }),
        "openai",
      );
      expect(view.status).toBe("invalid");
      expect(view.detail).not.toContain("your-api-key");
    });

    it("형식만 맞으면 **연결됨이 아니라 모르는 것**이다", () => {
      // 형식 검사는 오타를 잡을 뿐 유효성 보장이 아니다.
      // 이것을 connected로 세면 붙지 않은 시스템이 붙은 것처럼 보고된다.
      const view = stageOf(
        base({ env: { OPENAI_API_KEY: OPENAI_KEY } }),
        "openai",
      );
      expect(view.status).toBe("unverified");
      expect(view.done).toBe(false);
      expect(view.detail).toContain("아직 모릅니다");
      expect(view.evidence).toBeNull();
    });

    it("성공한 실 호출 기록이 있으면 연결됨이다 — 근거가 사실이다", () => {
      const view = stageOf(
        base({
          env: { OPENAI_API_KEY: OPENAI_KEY },
          llmSuccesses: { openai: 3 },
        }),
        "openai",
      );
      expect(view.status).toBe("connected");
      expect(view.done).toBe(true);
      expect(view.evidence).toBe("최근 30일 실 호출 성공 3건");
      // 근거에 기한이 있다 — 2년 전 성공으로 "지금도 붙어 있다"고 말할 수 없다
      expect(view.detail).toContain(`최근 ${ROLLOUT_EVIDENCE_WINDOW_DAYS}일`);
    });

    it("키가 없으면 성공 기록이 있어도 연결됨으로 보지 않는다", () => {
      // 키를 회수한 뒤에도 옛 성공 기록으로 "연결됨"이 유지되면 거짓이 된다
      const view = stageOf(base({ llmSuccesses: { openai: 9 } }), "openai");
      expect(view.status).toBe("not-configured");
    });
  });

  describe("Vision은 LLM Gateway를 탄다", () => {
    it("LLM_PROVIDER가 mock이면 Vision도 가짜다", () => {
      const view = stageOf(base(), "vision");
      expect(view.status).toBe("mock");
      expect(view.detail).toContain("별도 키가 없고");
    });

    it("실 Provider인데 vision 성공 기록이 없으면 모르는 것이다", () => {
      const view = stageOf(
        base({ env: { LLM_PROVIDER: "openai", OPENAI_API_KEY: OPENAI_KEY } }),
        "vision",
      );
      expect(view.status).toBe("unverified");
      // 이미지 첨부 형식은 Provider마다 다르다 — 조용히 빠질 수 있다
      expect(view.detail).toContain("이미지가 조용히 빠집니다");
    });

    it("vision-analysis 성공 기록이 있으면 연결됨이다", () => {
      const view = stageOf(
        base({
          env: { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: ANTHROPIC_KEY },
          visionSuccesses: 2,
        }),
        "vision",
      );
      expect(view.status).toBe("connected");
      expect(view.evidence).toBe("최근 30일 vision-analysis 성공 2건");
    });
  });

  describe("OCR", () => {
    it("기본은 mock이고, 그 결과가 사실이 아니라고 말한다", () => {
      const view = stageOf(base(), "ocr");
      expect(view.status).toBe("mock");
      expect(view.detail).toContain("사실이 아닙니다");
    });

    it("tesseract는 개발용이라 운영 연결로 세지 않는다 (결정 2401-⑤)", () => {
      const view = stageOf(
        base({
          env: { OCR_PROVIDER: DEV_ONLY_OCR_PROVIDERS[0] },
          ocrSuccesses: { tesseract: 5 },
        }),
        "ocr",
      );
      expect(view.status).toBe("dev-only");
      expect(view.done).toBe(false);
      // 성공 기록은 사실이므로 숨기지 않는다
      expect(view.evidence).toBe("최근 30일 OCR 실행 성공 5건");
    });

    it("알 수 없는 엔진 이름은 invalid이고 기동이 차단된다고 알린다", () => {
      const view = stageOf(base({ env: { OCR_PROVIDER: "google" } }), "ocr");
      expect(view.status).toBe("invalid");
      expect(view.detail).toContain("기동이 차단됩니다");
      // 조용히 mock으로 대체하지 않는다는 사실을 문구가 말한다
      expect(view.detail).toContain("조용히 mock으로 대체하지 않습니다");
    });

    it("운영 엔진을 골랐는데 키가 없으면 미구성이다", () => {
      const view = stageOf(
        base({ env: { OCR_PROVIDER: PRODUCTION_OCR_PROVIDER } }),
        "ocr",
      );
      expect(view.status).toBe("not-configured");
      expect(view.detail).toContain("GOOGLE_VISION_API_KEY");
    });

    it("키 형식만 맞으면 모르는 것, 성공 기록이 있으면 연결됨", () => {
      const configured = base({
        env: {
          OCR_PROVIDER: PRODUCTION_OCR_PROVIDER,
          GOOGLE_VISION_API_KEY: GOOGLE_KEY,
        },
      });
      expect(stageOf(configured, "ocr").status).toBe("unverified");
      expect(
        stageOf(
          { ...configured, ocrSuccesses: { [PRODUCTION_OCR_PROVIDER]: 1 } },
          "ocr",
        ).status,
      ).toBe("connected");
    });

    it("잘못된 키 형식은 값을 노출하지 않고 invalid로 말한다", () => {
      const view = stageOf(
        base({
          env: {
            OCR_PROVIDER: PRODUCTION_OCR_PROVIDER,
            GOOGLE_VISION_API_KEY: "changeme-please",
          },
        }),
        "ocr",
      );
      expect(view.status).toBe("invalid");
      expect(view.detail).not.toContain("changeme-please");
    });
  });

  describe("다음 단계와 순서 이탈", () => {
    it("아직 아무것도 없으면 첫 단계가 다음이다", () => {
      const judged = judgeProviderRollout(base());
      expect(judged.next).toBe("openai");
      expect(judged.summary).toEqual({ connected: 0, total: 5 });
      expect(judged.detail).toContain("연결 완료 0/5단계");
    });

    it("앞 단계가 끝나면 그다음이 다음 단계가 된다", () => {
      const judged = judgeProviderRollout(
        base({
          env: { OPENAI_API_KEY: OPENAI_KEY },
          llmSuccesses: { openai: 1 },
        }),
      );
      expect(judged.next).toBe("anthropic");
      expect(judged.summary.connected).toBe(1);
    });

    it("순서를 벗어난 진행은 말하되 막지 않는다", () => {
      // 이미 붙어서 돌아가는 것을 끊으면 잘 되던 것이 멈춘다 — 순서보다 나쁘다
      const judged = judgeProviderRollout(
        base({
          env: {
            OCR_PROVIDER: PRODUCTION_OCR_PROVIDER,
            GOOGLE_VISION_API_KEY: GOOGLE_KEY,
          },
          ocrSuccesses: { [PRODUCTION_OCR_PROVIDER]: 4 },
        }),
      );
      expect(judged.next).toBe("openai");
      expect(judged.outOfOrder).toEqual(["ocr"]);
      expect(judged.detail).toContain("막지는 않습니다");
    });

    it("전부 연결되면 다음 단계가 없다", () => {
      const judged = judgeProviderRollout({
        env: {
          OPENAI_API_KEY: OPENAI_KEY,
          ANTHROPIC_API_KEY: ANTHROPIC_KEY,
          GEMINI_API_KEY: GEMINI_KEY,
          LLM_PROVIDER: "openai",
          OCR_PROVIDER: PRODUCTION_OCR_PROVIDER,
          GOOGLE_VISION_API_KEY: GOOGLE_KEY,
        },
        llmSuccesses: { openai: 1, anthropic: 1, gemini: 1 },
        visionSuccesses: 1,
        ocrSuccesses: { [PRODUCTION_OCR_PROVIDER]: 1 },
      });
      expect(judged.next).toBeNull();
      expect(judged.outOfOrder).toEqual([]);
      expect(judged.summary).toEqual({ connected: 5, total: 5 });
      expect(judged.detail).toContain("모든 단계가 연결됐습니다");
    });
  });

  describe("가짜가 돌고 있는 단계", () => {
    it("mock 단계만 모아 준다", () => {
      const judged = judgeProviderRollout(base());
      expect(mockStages(judged).map((view) => view.stage)).toEqual([
        "vision",
        "ocr",
      ]);
    });

    it("실 Provider를 붙이면 목록에서 빠진다", () => {
      const judged = judgeProviderRollout(
        base({
          env: {
            LLM_PROVIDER: "openai",
            OPENAI_API_KEY: OPENAI_KEY,
            OCR_PROVIDER: PRODUCTION_OCR_PROVIDER,
            GOOGLE_VISION_API_KEY: GOOGLE_KEY,
          },
        }),
      );
      expect(mockStages(judged)).toEqual([]);
    });
  });

  it("어떤 조합에서도 마크다운 강조가 새지 않는다", () => {
    const inputs: RolloutInput[] = [
      base(),
      base({ env: { OPENAI_API_KEY: OPENAI_KEY } }),
      base({ env: { OCR_PROVIDER: "google" } }),
      base({
        env: { OCR_PROVIDER: PRODUCTION_OCR_PROVIDER },
        llmSuccesses: { gemini: 2 },
      }),
    ];
    for (const input of inputs) {
      const judged = judgeProviderRollout(input);
      expect(judged.detail).not.toContain("**");
      for (const view of judged.stages) {
        expect(view.detail).not.toContain("**");
      }
    }
  });
});

/**
 * 성공 기록의 **상대** (TASK-3401 — CTO 지시 4).
 *
 * 우리는 라이브 검증에서 계약 스텁을 쓰고, 그 실행도 성공으로 기록된다.
 * 주소가 스텁을 가리키는 동안 그 기록을 `connected`로 세면 붙지 않은
 * 시스템이 붙은 것으로 보고된다.
 */
describe("스텁을 상대로 만든 성공 기록 (TASK-3401)", () => {
  const base = {
    env: {
      OPENAI_API_KEY: "sk-live-000000000000000000000000000000000000000000000000",
      OCR_PROVIDER: "google-vision",
      GOOGLE_VISION_API_KEY: "AIzaSyTESTKEY0000000000000000000000000000",
    } as Record<string, string | undefined>,
    llmSuccesses: { openai: 12 },
    visionSuccesses: 0,
    ocrSuccesses: { "google-vision": 22 },
  };
  const stageOf = (input: typeof base, stage: string) =>
    judgeProviderRollout(input).stages.find((row) => row.stage === stage)!;

  it("Vision 스텁 주소면 OCR 성공 22건이 있어도 연결됨이 아니다", () => {
    const view = stageOf(
      {
        ...base,
        env: {
          ...base.env,
          GOOGLE_VISION_ENDPOINT: "http://127.0.0.1:9100/v1/images:annotate",
        },
      },
      "ocr",
    );
    expect(view.status).toBe("unverified");
    expect(view.done).toBe(false);
    expect(view.evidence).toBeNull();
    expect(view.detail).toContain("연결의 근거로 세지 않습니다");
  });

  it("공식 주소면 종전대로 연결됨이다", () => {
    const view = stageOf(base, "ocr");
    expect(view.status).toBe("connected");
  });

  it("OPENAI_BASE_URL이 우리 컴퓨터를 가리키면 LLM도 연결됨이 아니다", () => {
    const view = stageOf(
      { ...base, env: { ...base.env, OPENAI_BASE_URL: "http://localhost:9300/v1" } },
      "openai",
    );
    expect(view.status).toBe("unverified");
    expect(view.detail).toContain("OPENAI_BASE_URL");
  });

  it("주소를 바꾸지 않았으면 판정이 달라지지 않는다 — 미설정은 공식이다", () => {
    expect(stageOf(base, "openai").status).toBe("connected");
  });
});
