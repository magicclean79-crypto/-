import { judgeCiRuns, judgeCiWorkflow } from "./ci-workflow";
import { judgeEndpointOrigin, judgeProductionCutover } from "./production-cutover";
import type { CutoverInput } from "./production-cutover";

/**
 * 운영 전환 검증. (TASK-3401 — CTO 지시 4·5·6)
 *
 * 이 파일이 지키는 한 줄: **스텁을 상대로 만든 성공 기록을 연결의 증거로
 * 세지 않는다.** 우리는 라이브 검증에서 계약 스텁을 쓰고, 그 실행도 성공으로
 * 기록된다 — 상대가 누구였는지를 함께 보지 않으면 화면은 붙지 않은 시스템을
 * 붙었다고 보고한다.
 */

const OK_CI = {
  workflow: judgeCiWorkflow(
    [
      "- run: pnpm build",
      "- run: pnpm check:major-migrations",
      "- run: pnpm typecheck",
      "- run: pnpm lint",
      "- run: pnpm test",
      "- run: playwright install --with-deps chromium",
    ].join("\n"),
  ),
  runs: judgeCiRuns({
    runs: [
      {
        id: 1,
        branch: "main",
        sha: "abcdef12",
        status: "completed",
        conclusion: "success",
        createdAt: "2026-07-30T00:00:00Z",
      },
    ],
  }),
};

const REAL: CutoverInput = {
  env: {
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-live",
    OCR_PROVIDER: "google-vision",
    GOOGLE_VISION_API_KEY: "AIza-live",
    S3_ENDPOINT: "https://s3.ap-northeast-2.amazonaws.com",
    S3_BUCKET: "acos-prod",
    BACKUP_BUCKET: "acos-prod-backups",
    S3_ACCESS_KEY: "AKIAREAL",
    S3_SECRET_KEY: "secret",
  },
  llmSuccesses: { openai: 12 },
  ocrSuccesses: { "google-vision": 4 },
  storage: { reachable: true, bucketExists: true, detail: "버킷 acos-prod 확인" },
  ci: OK_CI,
};

const dep = (input: CutoverInput, id: string) =>
  judgeProductionCutover(input).dependencies.find((row) => row.id === id)!;

describe("엔드포인트 출처 판정 (TASK-3401)", () => {
  it("설정되지 않은 것은 실패가 아니다 — 공식 SDK 기본값을 쓴다", () => {
    expect(judgeEndpointOrigin(undefined, ["api.openai.com"]).origin).toBe("unset");
  });

  it("공식 호스트를 알아본다", () => {
    expect(judgeEndpointOrigin("https://api.openai.com/v1", ["api.openai.com"]).origin).toBe(
      "official",
    );
    expect(
      judgeEndpointOrigin("https://s3.ap-northeast-2.amazonaws.com", ["amazonaws.com"])
        .origin,
    ).toBe("official");
  });

  it("localhost는 스텁이다 — 성공 기록은 통신의 증거가 아니다", () => {
    const judged = judgeEndpointOrigin("http://127.0.0.1:9100", ["vision.googleapis.com"]);
    expect(judged.origin).toBe("local");
    expect(judged.detail).toContain("증거가 아닙니다");
  });

  it("사설 대역도 스텁으로 본다", () => {
    expect(judgeEndpointOrigin("http://192.168.0.9:9000", ["amazonaws.com"]).origin).toBe(
      "local",
    );
  });

  it("공식도 로컬도 아니면 무엇인지 확인되기 전까지 세지 않는다", () => {
    const judged = judgeEndpointOrigin("https://llm-proxy.example.com", [
      "api.openai.com",
    ]);
    expect(judged.origin).toBe("third-party");
  });
});

describe("운영 전환 판정 (TASK-3401)", () => {
  it("네 항목이 모두 실 연결이면 전환이 끝난 것이다", () => {
    const report = judgeProductionCutover(REAL);
    expect(report.ready).toBe(true);
    expect(report.summary).toEqual({ verified: 4, total: 4 });
  });

  it("하나라도 확인되지 않으면 ready가 아니다 — 운영 전환에 부분 점수는 없다", () => {
    const report = judgeProductionCutover({
      ...REAL,
      env: { ...REAL.env, OCR_PROVIDER: "mock" },
    });
    expect(report.ready).toBe(false);
    expect(report.detail).toContain("전환 완료로 세지 않습니다");
  });

  describe("LLM", () => {
    it("mock은 성공 기록이 있어도 연결이 아니다", () => {
      const view = dep(
        { ...REAL, env: { ...REAL.env, LLM_PROVIDER: "mock" } },
        "llm",
      );
      expect(view.status).toBe("not-production");
      expect(view.evidence).toBeNull();
    });

    it("키가 없으면 미구성이다 — 실패가 아니다", () => {
      const view = dep(
        { ...REAL, env: { ...REAL.env, OPENAI_API_KEY: undefined } },
        "llm",
      );
      expect(view.status).toBe("not-configured");
    });

    /**
     * 이 테스트가 이 파일의 핵심이다. `OPENAI_BASE_URL`은 우리 코드가 읽지
     * 않지만 공식 SDK가 읽는다 — 우리가 모르는 사이에 상대가 바뀔 수 있다.
     */
    it("주소가 우리 스텁으로 바뀌어 있으면 성공 기록을 근거로 쓰지 않는다", () => {
      const view = dep(
        {
          ...REAL,
          env: { ...REAL.env, OPENAI_BASE_URL: "http://localhost:9300/v1" },
        },
        "llm",
      );
      expect(view.status).toBe("not-production");
      expect(view.detail).toContain("운영 연결의 증거가 아닙니다");
    });

    it("주소는 공식인데 성공 기록이 없으면 모르는 것이다", () => {
      const view = dep({ ...REAL, llmSuccesses: {} }, "llm");
      expect(view.status).toBe("unverified");
      expect(view.detail).toContain("키가 있다는 것과");
    });

    it("모르는 Provider 이름은 설정 오류다", () => {
      const view = dep(
        { ...REAL, env: { ...REAL.env, LLM_PROVIDER: "llama" } },
        "llm",
      );
      expect(view.status).toBe("invalid");
    });
  });

  describe("Google Cloud Vision", () => {
    it("mock OCR은 운영이 아니다", () => {
      const view = dep({ ...REAL, env: { ...REAL.env, OCR_PROVIDER: "mock" } }, "vision");
      expect(view.status).toBe("not-production");
    });

    it("tesseract는 글자를 읽어도 운영 표준이 아니다 (결정 2401-⑤)", () => {
      const view = dep(
        { ...REAL, env: { ...REAL.env, OCR_PROVIDER: "tesseract" } },
        "vision",
      );
      expect(view.status).toBe("not-production");
      expect(view.detail).toContain("운영 표준");
    });

    it("Vision 계약 스텁을 가리키면 성공 기록이 있어도 전환이 아니다", () => {
      const view = dep(
        {
          ...REAL,
          env: { ...REAL.env, GOOGLE_VISION_ENDPOINT: "http://127.0.0.1:9100/v1" },
        },
        "vision",
      );
      expect(view.status).toBe("not-production");
      expect(view.detail).toContain("이 주소를 상대로");
    });

    it("공식 주소로 성공한 기록이 있으면 근거와 함께 통과다", () => {
      const view = dep(REAL, "vision");
      expect(view.status).toBe("verified");
      expect(view.evidence).toContain("4건");
    });
  });

  describe("Amazon S3", () => {
    it("주소가 없으면 아직 전환하지 않은 것이다 — 실패가 아니다", () => {
      const view = dep({ ...REAL, env: { ...REAL.env, S3_ENDPOINT: undefined } }, "storage");
      expect(view.status).toBe("not-configured");
    });

    it("s3rver·MinIO는 개발 전용이다", () => {
      const view = dep(
        { ...REAL, env: { ...REAL.env, S3_ENDPOINT: "http://localhost:9000" } },
        "storage",
      );
      expect(view.status).toBe("not-production");
    });

    it("주소는 S3인데 자격 증명이 개발 기본값이면 전환이 끝난 게 아니다", () => {
      const view = dep(
        { ...REAL, env: { ...REAL.env, S3_ACCESS_KEY: "minioadmin" } },
        "storage",
      );
      expect(view.status).toBe("invalid");
      expect(view.detail).toContain("minioadmin");
    });

    it("이미지 버킷과 백업 버킷이 같으면 막는다 (결정 1701-②)", () => {
      const view = dep(
        { ...REAL, env: { ...REAL.env, BACKUP_BUCKET: "acos-prod" } },
        "storage",
      );
      expect(view.status).toBe("invalid");
      expect(view.detail).toContain("함께 사라집니다");
    });

    it("접근 점검 결과가 없으면 설정만으로 통과시키지 않는다", () => {
      const view = dep({ ...REAL, storage: null }, "storage");
      expect(view.status).toBe("unverified");
    });

    it("버킷에 닿지 못하면 설정 오류로 말한다", () => {
      const view = dep(
        {
          ...REAL,
          storage: { reachable: false, bucketExists: false, detail: "AccessDenied" },
        },
        "storage",
      );
      expect(view.status).toBe("invalid");
      expect(view.detail).toContain("AccessDenied");
    });
  });

  describe("GitHub Actions", () => {
    it("실행이 계속 실패하면 게이트가 있다고 말하지 않는다", () => {
      const view = dep(
        {
          ...REAL,
          ci: {
            workflow: OK_CI.workflow,
            runs: judgeCiRuns({
              runs: [
                {
                  id: 9,
                  branch: "main",
                  sha: "8b6814eb",
                  status: "completed",
                  conclusion: "failure",
                  createdAt: "2026-07-30T18:45:00Z",
                },
              ],
            }),
          },
        },
        "ci",
      );
      expect(view.status).toBe("invalid");
      expect(view.detail).toContain("초록으로 끝나는 것은 다릅니다");
    });

    it("판정 결과가 없으면 모르는 것이다", () => {
      expect(dep({ ...REAL, ci: null }, "ci").status).toBe("unverified");
    });

    it("워크플로에 게이트가 빠져 있으면 실행이 초록이어도 통과가 아니다", () => {
      const view = dep(
        {
          ...REAL,
          ci: { workflow: judgeCiWorkflow("- run: pnpm build"), runs: OK_CI.runs },
        },
        "ci",
      );
      expect(view.status).toBe("invalid");
    });
  });
});
