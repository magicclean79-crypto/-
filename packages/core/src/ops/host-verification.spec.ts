import {
  hostOf,
  hostVerificationCheck,
  parseHostList,
  verifyProductionHosts,
} from "./host-verification";
import type { ObservedHost } from "./host-verification";

function observed(host: string, source = "PUBLIC_BASE_URL"): ObservedHost {
  return { host, source, fromTraffic: false };
}

describe("parseHostList · hostOf", () => {
  it("쉼표 목록을 읽고 공백·대소문자를 정리한다", () => {
    expect(parseHostList(" ACOS.example , www.acos.example ,, ")).toEqual([
      "acos.example",
      "www.acos.example",
    ]);
    expect(parseHostList(undefined)).toEqual([]);
  });

  it("주소에서 호스트만 꺼내고, 읽을 수 없으면 null이다", () => {
    expect(hostOf("https://Acos.Example/path")).toBe("acos.example");
    expect(hostOf("acos.example")).toBeNull();
    expect(hostOf(null)).toBeNull();
  });
});

describe("verifyProductionHosts", () => {
  it("목록과 관측이 맞으면 그렇게 말한다", () => {
    const report = verifyProductionHosts({
      declared: ["acos.example"],
      observed: [observed("acos.example")],
      tier: "production",
    });
    expect(report.undeclared).toHaveLength(0);
    expect(report.detail).toContain("목록과 관측이 일치합니다");
    expect(hostVerificationCheck(report).status).toBe("ok");
  });

  it("목록에 없는데 쓰이는 호스트를 찾아 사람에게 묻는다", () => {
    const report = verifyProductionHosts({
      declared: ["acos.example"],
      observed: [observed("acos.example"), observed("api.acos.example", "S3_ENDPOINT")],
      tier: "production",
    });
    expect(report.undeclared.map((row) => row.host)).toEqual(["api.acos.example"]);
    expect(report.detail).toContain("이것이 운영이라면");
    expect(hostVerificationCheck(report).status).toBe("warn");
  });

  /**
   * 자동으로 채우면 이 보호가 스스로 무력해진다 — 그 이유가 판정 문구에
   * 남아 있어야 다음 사람이 "자동화하면 되잖아"로 되돌리지 않는다.
   */
  it("자동으로 목록에 넣지 않는 이유를 말한다", () => {
    const report = verifyProductionHosts({
      declared: ["acos.example"],
      observed: [observed("staging.acos.example")],
      tier: "staging",
    });
    expect(report.detail).toContain("자동으로 넣지 않는 이유는");
    expect(report.detail).toContain("스테이징까지 운영으로 올라가");
  });

  /**
   * 라이브 검증에서 드러난 결함: `localhost`를 두고 "이것이 운영
   * 호스트라면 목록에 넣어 주세요"라고 물었다. 그 제안을 따르면 검증 대상
   * 보호가 모든 로컬 대상을 운영으로 보고 거부한다 — 그리고 명백히 틀린
   * 질문을 하는 목록은 곧 아무도 안 읽는다.
   */
  it("사설망·로컬 주소는 운영 후보로 묻지 않는다", () => {
    for (const host of ["localhost", "127.0.0.1", "192.168.1.5", "10.1.2.3", "dev.local"]) {
      const report = verifyProductionHosts({
        declared: ["acos.example"],
        observed: [observed(host)],
        tier: "production",
      });
      expect(report.undeclared).toHaveLength(0);
      const finding = report.findings.find((row) => row.host === host);
      expect(finding?.verdict).toBe("not-applicable");
      expect(finding?.detail).toContain("목록에 넣지 마세요");
    }
  });

  it("목록에 있는데 안 보이는 것을 실패로 만들지 않는다", () => {
    const report = verifyProductionHosts({
      declared: ["acos.example", "old.acos.example"],
      observed: [observed("acos.example")],
      tier: "production",
    });
    expect(report.unseen.map((row) => row.host)).toEqual(["old.acos.example"]);
    expect(report.unseen[0].detail).toContain("없어졌다는 뜻이 아니라");
    expect(hostVerificationCheck(report).status).toBe("ok");
  });

  it("운영에서 목록이 비어 있으면 보호가 꺼진 것이다", () => {
    const report = verifyProductionHosts({
      declared: [],
      observed: [observed("acos.example")],
      tier: "production",
    });
    expect(report.detail).toContain("사실상 꺼져 있습니다");
    expect(hostVerificationCheck(report).status).toBe("fail");
  });

  it("개발에서는 목록을 요구하지 않는다 — 요구하면 그 경고가 배경이 된다", () => {
    const report = verifyProductionHosts({
      declared: [],
      observed: [observed("localhost")],
      tier: "development",
    });
    expect(report.required).toBe(false);
    expect(hostVerificationCheck(report).status).toBe("ok");
  });

  it("같은 호스트를 여러 곳에서 봤으면 출처를 모은다", () => {
    const report = verifyProductionHosts({
      declared: [],
      observed: [observed("api.acos.example", "S3_ENDPOINT"), observed("api.acos.example", "실행 기록")],
      tier: "staging",
    });
    expect(report.findings[0].sources).toEqual(["S3_ENDPOINT", "실행 기록"]);
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    for (const declared of [[], ["acos.example"]]) {
      const report = verifyProductionHosts({
        declared,
        observed: [observed("x.example")],
        tier: "production",
      });
      expect(report.detail).not.toContain("**");
      for (const finding of report.findings) {
        expect(finding.detail).not.toContain("**");
      }
    }
  });
});
