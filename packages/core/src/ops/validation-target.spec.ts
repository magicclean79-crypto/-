import {
  judgeValidationTarget,
  resolveDeploymentTier,
  validationTargetCheck,
} from "./validation-target";
import type { ValidationTargetInput } from "./validation-target";

function input(overrides: Partial<ValidationTargetInput> = {}): ValidationTargetInput {
  return {
    raw: "https://staging.acos.example",
    ack: "staging.acos.example",
    productionHosts: "acos.example,www.acos.example",
    selfUrl: "https://dev.acos.example",
    tier: "development",
    ...overrides,
  };
}

describe("resolveDeploymentTier", () => {
  it("DEPLOY_TIER를 그대로 읽는다", () => {
    expect(resolveDeploymentTier({ DEPLOY_TIER: "staging" })).toBe("staging");
    expect(resolveDeploymentTier({ DEPLOY_TIER: "prod" })).toBe("production");
    expect(resolveDeploymentTier({ DEPLOY_TIER: "dev" })).toBe("development");
  });

  it("모르면 개발로 본다 — 반대로 두면 노트북이 운영이 되어 경보가 쏟아진다", () => {
    expect(resolveDeploymentTier({})).toBe("development");
    expect(resolveDeploymentTier({ DEPLOY_TIER: "무엇" })).toBe("development");
  });

  it("DEPLOY_TIER가 없고 NODE_ENV=production이면 더 엄격한 쪽으로 본다", () => {
    expect(resolveDeploymentTier({ NODE_ENV: "production" })).toBe("production");
  });
});

describe("judgeValidationTarget", () => {
  it("미설정은 실패가 아니다 — 아직 정하지 않은 것이다", () => {
    const judged = judgeValidationTarget(input({ raw: undefined }));
    expect(judged.verdict).toBe("unset");
    expect(judged.usable).toBe(false);
    expect(validationTargetCheck(judged).status).toBe("ok");
  });

  it("주소로 읽을 수 없으면 invalid다", () => {
    expect(judgeValidationTarget(input({ raw: "staging.example" })).verdict).toBe(
      "invalid",
    );
    expect(judgeValidationTarget(input({ raw: "ftp://x.example" })).verdict).toBe(
      "invalid",
    );
  });

  it("운영 호스트를 가리키면 거부한다 — 확인을 받아도 허용하지 않는다", () => {
    const judged = judgeValidationTarget(
      input({ raw: "https://acos.example", ack: "acos.example" }),
    );
    expect(judged.verdict).toBe("production");
    expect(judged.usable).toBe(false);
    expect(judged.detail).toContain("검증이 아니라");
    expect(validationTargetCheck(judged).status).toBe("fail");
  });

  it("지금 이 인스턴스를 가리키면 거부한다", () => {
    const judged = judgeValidationTarget(
      input({
        raw: "https://dev.acos.example",
        ack: "dev.acos.example",
        selfUrl: "https://dev.acos.example",
      }),
    );
    expect(judged.verdict).toBe("self");
    expect(judged.detail).toContain("자기가 자기를 검증");
  });

  it("사설망·노트북을 가리키면 거부한다", () => {
    for (const host of ["localhost", "127.0.0.1", "192.168.0.9", "10.0.0.4", "my.local"]) {
      const judged = judgeValidationTarget(
        input({ raw: `http://${host}:3000`, ack: host }),
      );
      expect(judged.verdict).toBe("local");
    }
  });

  it("주소만 있고 확인이 없으면 아직 쓸 수 없다", () => {
    const judged = judgeValidationTarget(input({ ack: undefined }));
    expect(judged.verdict).toBe("unacknowledged");
    expect(judged.usable).toBe(false);
    expect(judged.detail).toContain("다른 행동입니다");
    // 확인 누락은 실패가 아니라 주의다 — 주소 자체는 성립한다
    expect(validationTargetCheck(judged).status).toBe("warn");
  });

  it("대상을 바꾸고 확인을 안 바꾼 것을 잡는다", () => {
    const judged = judgeValidationTarget(input({ ack: "old.acos.example" }));
    expect(judged.verdict).toBe("unacknowledged");
    expect(judged.detail).toContain("대상을 바꾸고 확인을 안 바꾼");
  });

  it("확인까지 있으면 쓸 수 있다", () => {
    const judged = judgeValidationTarget(input());
    expect(judged.verdict).toBe("accepted");
    expect(judged.usable).toBe(true);
    expect(judged.host).toBe("staging.acos.example");
    expect(validationTargetCheck(judged).status).toBe("ok");
  });

  it("운영 인스턴스에서는 대상이 성립해도 그 사실을 말한다", () => {
    const judged = judgeValidationTarget(input({ tier: "production" }));
    expect(judged.verdict).toBe("accepted");
    expect(judged.next).toContain("대상 환경에서 돌려야");
  });

  it("위험 순서대로 판정한다 — 운영이 확인 누락보다 앞선다", () => {
    const judged = judgeValidationTarget(
      input({ raw: "https://acos.example", ack: undefined }),
    );
    expect(judged.verdict).toBe("production");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    for (const raw of [undefined, "x", "https://acos.example", "http://localhost:3000"]) {
      const judged = judgeValidationTarget(input({ raw, ack: undefined }));
      expect(judged.detail).not.toContain("**");
    }
  });
});
