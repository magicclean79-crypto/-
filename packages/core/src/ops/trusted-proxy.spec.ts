import {
  isTrustedPeer,
  normalizePeerAddress,
  parseTrustedProxies,
  resolveForwardedHost,
  trustedProxyCheck,
} from "./trusted-proxy";

const RULES = parseTrustedProxies("10.0.0.5, 192.168.1.0/24").rules;

describe("parseTrustedProxies", () => {
  it("단일 IP와 CIDR을 읽는다", () => {
    const { rules, rejected } = parseTrustedProxies("10.0.0.5, 192.168.1.0/24");
    expect(rules.map((rule) => rule.raw)).toEqual(["10.0.0.5", "192.168.1.0/24"]);
    expect(rejected).toEqual([]);
  });

  /**
   * 조용히 버리면 오타 하나로 신뢰 경계가 좁아진 것을 아무도 모른다.
   */
  it("읽을 수 없는 선언을 버리되 돌려준다", () => {
    const { rules, rejected } = parseTrustedProxies("10.0.0.5, nonsense, 10.0.0.0/99, ::1");
    expect(rules).toHaveLength(1);
    expect(rejected).toEqual(["nonsense", "10.0.0.0/99", "::1"]);
  });

  it("비어 있으면 규칙이 없다", () => {
    expect(parseTrustedProxies(undefined).rules).toEqual([]);
    expect(parseTrustedProxies("  ,  ").rules).toEqual([]);
  });
});

describe("normalizePeerAddress", () => {
  /**
   * Node가 이중 스택 소켓에서 이 모양을 준다. 벗기지 않으면 선언한 프록시가
   * 하나도 안 맞고, 그러면 이 기능이 조용히 꺼진 것과 같아진다.
   */
  it("IPv6에 섞여 오는 IPv4를 꺼낸다", () => {
    expect(normalizePeerAddress("::ffff:10.0.0.5")).toBe("10.0.0.5");
    expect(normalizePeerAddress("10.0.0.5")).toBe("10.0.0.5");
    expect(normalizePeerAddress("")).toBeNull();
    expect(normalizePeerAddress(undefined)).toBeNull();
  });
});

describe("isTrustedPeer", () => {
  it("단일 IP와 CIDR 범위를 맞춘다", () => {
    expect(isTrustedPeer("10.0.0.5", RULES)).toBe(true);
    expect(isTrustedPeer("::ffff:10.0.0.5", RULES)).toBe(true);
    expect(isTrustedPeer("192.168.1.77", RULES)).toBe(true);
    expect(isTrustedPeer("192.168.2.77", RULES)).toBe(false);
    expect(isTrustedPeer("10.0.0.6", RULES)).toBe(false);
  });

  it("선언이 없으면 아무도 신뢰하지 않는다", () => {
    expect(isTrustedPeer("10.0.0.5", [])).toBe(false);
  });

  /**
   * 0.0.0.0/0은 신뢰 경계가 아니라 경계를 없앤 것이다 — 그 선언으로
   * 아무나 우리 관측에 글을 쓰게 두지 않는다.
   */
  it("전체 대역 선언은 맞지 않는 것으로 본다", () => {
    const all = parseTrustedProxies("0.0.0.0/0").rules;
    expect(isTrustedPeer("203.0.113.9", all)).toBe(false);
  });
});

describe("resolveForwardedHost", () => {
  const base = {
    host: "api.internal",
    forwardedHost: "acos.example",
    peer: "10.0.0.5",
    rules: RULES,
  };

  it("신뢰하는 프록시가 보낸 값 하나면 그것을 쓴다", () => {
    const result = resolveForwardedHost(base);
    expect(result).toMatchObject({
      host: "acos.example",
      verdict: "trusted",
      via: "proxy",
    });
  });

  /**
   * 기본값은 언제나 "안 믿는다"다 — 선언 없이 전달 헤더를 보면 누가
   * 적었는지 모르는 이름이 관측에 들어간다.
   */
  it("선언이 없으면 전달 헤더를 보지 않는다", () => {
    const result = resolveForwardedHost({ ...base, rules: [] });
    expect(result.host).toBe("api.internal");
    expect(result.verdict).toBe("not-configured");
    expect(result.detail).toContain("선언 없이 보면");
  });

  /**
   * 조용히 버리면 "누군가 프록시인 척했다"는 사실까지 사라진다.
   */
  it("신뢰하지 않는 상대의 전달 헤더는 버리고 그 사실을 말한다", () => {
    const result = resolveForwardedHost({ ...base, peer: "203.0.113.9" });
    expect(result.host).toBe("api.internal");
    expect(result.verdict).toBe("untrusted");
    expect(result.detail).toContain("바깥에서 온 글");
  });

  /**
   * 덧붙이는 프록시인지 덮어쓰는 프록시인지 모르는 상태에서 하나를 고르면,
   * 고른 이유가 없는 값이 관측에 들어간다.
   */
  it("값이 여러 개면 추측하지 않는다", () => {
    const result = resolveForwardedHost({
      ...base,
      forwardedHost: "evil.example, acos.example",
    });
    expect(result.host).toBe("api.internal");
    expect(result.verdict).toBe("ambiguous");
    expect(result.detail).toContain("덮어쓰도록");
  });

  it("헤더가 배열로 와도 여러 값으로 본다", () => {
    const result = resolveForwardedHost({
      ...base,
      forwardedHost: ["a.example", "b.example"],
    });
    expect(result.verdict).toBe("ambiguous");
  });

  it("전달 헤더가 없으면 Host를 그대로 본다", () => {
    const result = resolveForwardedHost({ ...base, forwardedHost: undefined });
    expect(result).toMatchObject({ host: "api.internal", verdict: "absent" });
  });

  it("Host도 없으면 null이다 — 지어내지 않는다", () => {
    const result = resolveForwardedHost({
      ...base,
      host: undefined,
      forwardedHost: undefined,
    });
    expect(result.host).toBeNull();
  });
});

describe("trustedProxyCheck", () => {
  const base = {
    declared: 1,
    rejected: [] as string[],
    untrusted: 0,
    ambiguous: 0,
    viaProxy: 5,
    observedRequests: 10,
  };

  /**
   * 프록시를 안 쓰는 구성도 정상이다 — 없는 것을 실패로 칠하면 그 경고가
   * 배경 소음이 된다.
   */
  it("선언이 없는 것은 실패가 아니다", () => {
    const report = trustedProxyCheck({ ...base, declared: 0, viaProxy: 0 });
    expect(report.status).toBe("ok");
    expect(report.detail).toContain("전달 헤더를 보지 않습니다");
  });

  /**
   * 선언해 놓고 한 번도 안 맞았다면 이 기능은 지금 꺼져 있는 것과 같다.
   */
  it("선언했는데 한 번도 안 맞으면 말한다", () => {
    const report = trustedProxyCheck({ ...base, viaProxy: 0 });
    expect(report.status).toBe("warn");
    expect(report.detail).toContain("전달 헤더로 관측된 요청이 하나도 없습니다");
  });

  it("버린 선언·버린 헤더·모호한 헤더를 각각 말한다", () => {
    const report = trustedProxyCheck({
      ...base,
      rejected: ["nonsense"],
      untrusted: 3,
      ambiguous: 2,
    });
    expect(report.status).toBe("warn");
    expect(report.detail).toContain("읽을 수 없는 선언 1개");
    expect(report.detail).toContain("요청 3건을 버렸습니다");
    expect(report.detail).toContain("요청 2건이 있습니다");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const report = trustedProxyCheck({
      ...base,
      declared: 0,
      rejected: ["x"],
      untrusted: 1,
      ambiguous: 1,
    });
    expect(report.detail).not.toContain("**");
  });
});
