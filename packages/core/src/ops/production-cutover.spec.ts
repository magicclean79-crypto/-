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
      "- run: pnpm check:ci-gates",
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
  egress: [],
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

/**
 * 도달 점검 (TASK-3501 — CTO 지시 2·3).
 *
 * **키가 틀린 것과 길이 막힌 것은 다릅니다.** 둘 다 "호출 실패"로 보이면
 * 사람은 있지도 않은 키 문제를 몇 시간씩 찾습니다. 실제로 이 환경에서
 * `api.openai.com`이 프록시에 막혀 있었습니다.
 */
describe("공식 주소 도달 점검 (TASK-3501)", () => {
  const blocked = (host: string) => ({
    host,
    status: "blocked" as const,
    reachable: false,
    detail: "CONNECT tunnel failed, response 403",
  });

  const ambiguous = (host: string) => ({
    host,
    status: "ambiguous" as const,
    reachable: false,
    detail: "HTTP 403 — Provider가 거절한 것인지 프록시가 막은 것인지 가릴 수 없습니다.",
  });

  it("길이 막혀 있으면 키 이야기를 하기 전에 그것부터 말한다", () => {
    const view = dep(
      { ...REAL, egress: [blocked("api.openai.com")] },
      "llm",
    );
    expect(view.status).toBe("unreachable");
    expect(view.detail).toContain("키가 틀린 것이 아니라");
    expect(view.next).toContain("아웃바운드를 열어");
  });

  it("Vision도 같다", () => {
    const view = dep(
      { ...REAL, egress: [blocked("vision.googleapis.com")] },
      "vision",
    );
    expect(view.status).toBe("unreachable");
  });

  it("S3도 같다", () => {
    const view = dep(
      { ...REAL, egress: [blocked("s3.ap-northeast-2.amazonaws.com")] },
      "storage",
    );
    expect(view.status).toBe("unreachable");
  });

  it("키가 없을 때도 길이 막힌 사실을 함께 말한다", () => {
    const view = dep(
      {
        ...REAL,
        env: { ...REAL.env, OPENAI_API_KEY: undefined },
        egress: [blocked("api.openai.com")],
      },
      "llm",
    );
    // 아직 안 붙인 것이 먼저다 — 다만 키를 넣어도 안 된다는 사실을 덧붙인다
    expect(view.status).toBe("not-configured");
    expect(view.detail).toContain("키를 넣어도 이 길이 열리기 전까지는");
  });

  it("점검하지 않았으면 막혔다고도 닿는다고도 말하지 않는다", () => {
    expect(dep({ ...REAL, egress: [] }, "llm").status).toBe("verified");
    expect(dep({ ...REAL, egress: undefined }, "llm").status).toBe("verified");
  });

  /**
   * 라이브에서 실제로 틀렸던 판정이다. `api.openai.com`의 403은 **프록시가**
   * 막은 것이었는데 처음 판정은 그것을 "닿음"으로 세고 `verified`까지 갔다.
   */
  it("403은 닿았다고도 막혔다고도 말하지 않는다 — 누가 막았는지 모른다", () => {
    const view = dep({ ...REAL, egress: [ambiguous("api.openai.com")] }, "llm");
    expect(view.status).toBe("unverified");
    expect(view.detail).toContain("가릴 수 없습니다");
    expect(view.evidence).toBeNull();
    // 같은 문장을 두 번 적지 않는다 (TASK-3401에서 고친 겹침의 재발 방지)
    expect(view.detail.split("가릴 수 없습니다").length - 1).toBe(1);
  });

  it("403이어도 성공 기록만으로 통과시키지 않는다", () => {
    // 성공 기록 12건이 있어도 verified가 아니다
    const report = judgeProductionCutover({
      ...REAL,
      egress: [ambiguous("api.openai.com")],
    });
    expect(report.ready).toBe(false);
  });

  it("스텁을 가리키는 중이면 공식 주소가 막혀도 그 이야기를 먼저 하지 않는다", () => {
    // 지금 문제는 상대가 스텁이라는 것이다 — 길 이야기는 그다음이다
    const view = dep(
      {
        ...REAL,
        env: { ...REAL.env, OPENAI_BASE_URL: "http://localhost:9300/v1" },
        egress: [blocked("api.openai.com")],
      },
      "llm",
    );
    expect(view.status).toBe("not-production");
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
