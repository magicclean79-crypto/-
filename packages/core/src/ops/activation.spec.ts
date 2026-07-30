import { judgeActivation } from "./activation";
import type { ActivationInput } from "./activation";

/**
 * 운영 활성화 판정 (TASK-3601 — CTO 정책 3601-①).
 *
 * 이 파일이 지키는 한 줄: **세 조건이 모두 충족될 때만 완료다.**
 * 둘이 충족된 상태는 "거의 다"가 아니라 여전히 전환되지 않은 상태다.
 */

const READY: ActivationInput = {
  env: {
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "sk-proj-0000000000000000000000000000000000000000000000000",
    OCR_PROVIDER: "google-vision",
    GOOGLE_VISION_API_KEY: "AIzaSy0000000000000000000000000000000000",
    S3_ENDPOINT: "https://s3.ap-northeast-2.amazonaws.com",
    S3_ACCESS_KEY: "AKIAREAL",
    S3_SECRET_KEY: "secret",
  },
  egress: [
    { host: "api.openai.com", status: "reachable", reachable: true, detail: "HTTP 401" },
    {
      host: "vision.googleapis.com",
      status: "reachable",
      reachable: true,
      detail: "HTTP 404",
    },
  ],
  cutover: {
    ready: true,
    applicable: true,
    environment: "production",
    detail: "운영 전환 4/4항목이 실제 연결로 확인됐습니다.",
  },
};

const condition = (input: ActivationInput, id: string) =>
  judgeActivation(input).conditions.find((row) => row.id === id)!;

describe("운영 활성화 (TASK-3601, CTO 정책 3601-①)", () => {
  it("세 조건이 모두 충족되면 완료다", () => {
    const report = judgeActivation(READY);
    expect(report.activated).toBe(true);
    expect(report.conditions).toHaveLength(3);
    expect(report.detail).toContain("운영 활성화 완료");
  });

  it("하나라도 빠지면 완료가 아니다 — 부분 점수는 없다", () => {
    const report = judgeActivation({
      ...READY,
      cutover: { ...READY.cutover, ready: false, detail: "남은 항목이 있습니다." },
    });
    expect(report.activated).toBe(false);
    expect(report.detail).toContain("2/3 조건 충족");
    expect(report.detail).toContain("세 조건이 모두 충족될 때만");
  });

  describe("자격 증명", () => {
    it("mock이면 충족이 아니다", () => {
      const view = condition(
        { ...READY, env: { ...READY.env, LLM_PROVIDER: "mock" } },
        "credentials",
      );
      expect(view.met).toBe(false);
      expect(view.detail).toContain("LLM_PROVIDER");
    });

    it("키가 없으면 무엇이 없는지 이름으로 말한다", () => {
      const view = condition(
        { ...READY, env: { ...READY.env, GOOGLE_VISION_API_KEY: undefined } },
        "credentials",
      );
      expect(view.met).toBe(false);
      expect(view.next).toContain("GOOGLE_VISION_API_KEY");
    });

    it("S3 자격 증명이 개발 기본값이면 충족이 아니다", () => {
      const view = condition(
        { ...READY, env: { ...READY.env, S3_ACCESS_KEY: "minioadmin" } },
        "credentials",
      );
      expect(view.met).toBe(false);
      expect(view.detail).toContain("minioadmin");
    });

    it("저장소가 아직 S3가 아니면 그 사실을 말한다", () => {
      const view = condition(
        { ...READY, env: { ...READY.env, S3_ENDPOINT: "http://localhost:9000" } },
        "credentials",
      );
      expect(view.met).toBe(false);
      expect(view.detail).toContain("S3_ENDPOINT");
    });

    it("형식만 본다 — 유효성은 실제 호출이 안다", () => {
      expect(condition(READY, "credentials").detail).toContain("형식 기준");
    });
  });

  describe("네트워크", () => {
    it("점검하지 않았으면 충족이 아니다 — 모르는 것을 닿는다고 하지 않는다", () => {
      const view = condition({ ...READY, egress: [] }, "network");
      expect(view.met).toBe(false);
      expect(view.detail).toContain("점검하지 않은 것을");
    });

    it("막힌 곳이 있으면 어디가 막혔는지 말한다", () => {
      const view = condition(
        {
          ...READY,
          egress: [
            {
              host: "api.openai.com",
              status: "blocked",
              reachable: false,
              detail: "CONNECT tunnel failed",
            },
          ],
        },
        "network",
      );
      expect(view.met).toBe(false);
      expect(view.detail).toContain("api.openai.com");
      expect(view.next).toContain("아웃바운드를 열어");
    });

    it("403(가릴 수 없음)도 충족이 아니다", () => {
      const view = condition(
        {
          ...READY,
          egress: [
            {
              host: "api.openai.com",
              status: "ambiguous",
              reachable: false,
              detail: "HTTP 403",
            },
          ],
        },
        "network",
      );
      expect(view.met).toBe(false);
      expect(view.detail).toContain("가릴 수 없음");
    });
  });

  describe("환경", () => {
    it("전환 대상이 아닌 환경이면 그 사실을 먼저 말한다 (정책 3501-①)", () => {
      const report = judgeActivation({
        ...READY,
        cutover: { ...READY.cutover, applicable: false, environment: "development" },
      });
      expect(report.applicable).toBe(false);
      expect(report.detail).toContain("활성화 대상이 아닙니다");
      // 판정 자체는 감추지 않는다
      expect(report.conditions).toHaveLength(3);
    });
  });
});
