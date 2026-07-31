import {
  HOST_DISCOVERY_LIMIT,
  HostSightingBuffer,
  judgeHostDiscovery,
  mergeSightings,
  normalizeHostHeader,
} from "./host-discovery";
import type { HostSighting } from "./host-discovery";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

function sighting(host: string, over: Partial<HostSighting> = {}): HostSighting {
  return {
    host,
    requests: 1,
    firstSeenAt: NOW - 60_000,
    lastSeenAt: NOW - 60_000,
    ...over,
  };
}

describe("normalizeHostHeader", () => {
  it("포트를 떼고 소문자로 맞춘다", () => {
    expect(normalizeHostHeader("ACOS.Example:8443")).toBe("acos.example");
    expect(normalizeHostHeader(" acos.example ")).toBe("acos.example");
  });

  it("IPv6 리터럴은 대괄호를 유지한다", () => {
    expect(normalizeHostHeader("[::1]:4000")).toBe("[::1]");
  });

  /**
   * 이 값들이 목록에 들어가면 바깥에서 우리 보호 목록에 글을 쓰는 셈이 된다.
   */
  it("호스트 이름일 수 없는 값은 버린다", () => {
    for (const raw of [
      "acos.example/../etc",
      "acos example",
      "acos.example\r\nX-Injected: 1",
      "<script>",
      "",
      "  ",
      42,
      null,
      undefined,
      "a".repeat(300),
    ]) {
      expect(normalizeHostHeader(raw)).toBeNull();
    }
  });
});

describe("judgeHostDiscovery", () => {
  it("관측을 호스트 검증에 넘길 형태로 만들고 트래픽 출처를 표시한다", () => {
    const report = judgeHostDiscovery({
      sightings: [sighting("m.acos.example", { requests: 12 })],
      now: NOW,
    });
    expect(report.observed).toEqual([
      { host: "m.acos.example", source: "운영 트래픽 12건", fromTraffic: true },
    ]);
    expect(report.detail).toContain("관측은 증거이지 허가가 아닙니다");
  });

  /**
   * 관측이 없는 것을 "별칭이 없다"로 읽으면, 트래픽이 아직 없는 새 환경에서
   * 이 검사가 초록이 된다 — 모르는 것을 통과로 처리하는 그 모양이다.
   */
  it("관측이 없는 것을 별칭이 없다는 뜻으로 말하지 않는다", () => {
    const report = judgeHostDiscovery({ sightings: [], now: NOW });
    expect(report.detail).toContain("별칭이 없다는 뜻이 아니라");
    expect(report.observed).toHaveLength(0);
  });

  /**
   * 넘친 상태에서 "목록에 없는 호스트 0개"는 사실이 아니라 우리가 더 안 본
   * 것이다. 그 사실이 보고서에 남아야 한다.
   */
  it("상한을 넘으면 관측이 불완전하다고 말한다", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      sighting(`h${index}.example`, { requests: 60 - index }),
    );
    const report = judgeHostDiscovery({ sightings: many, now: NOW });
    expect(report.overflowed).toBe(true);
    expect(report.sightings).toHaveLength(HOST_DISCOVERY_LIMIT);
    expect(report.distinct).toBe(60);
    expect(report.detail).toContain("이 관측은 불완전하고");
    // 많이 들어온 것부터 남긴다
    expect(report.sightings[0].host).toBe("h0.example");
  });

  it("버린 요청 수를 조용히 삼키지 않는다", () => {
    const report = judgeHostDiscovery({
      sightings: [sighting("acos.example")],
      now: NOW,
      rejected: 7,
    });
    expect(report.detail).toContain("호스트 이름이 아닌 값 7건");
  });

  it("오래된 관측은 지금도 쓰인다고 세지 않는다", () => {
    const report = judgeHostDiscovery({
      sightings: [
        sighting("old.example", { lastSeenAt: NOW - 40 * 86_400_000 }),
        sighting("now.example"),
      ],
      now: NOW,
    });
    expect(report.stale.map((row) => row.host)).toEqual(["old.example"]);
    expect(report.observed.map((row) => row.host)).toEqual(["now.example"]);
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const report = judgeHostDiscovery({
      sightings: [sighting("a.example")],
      now: NOW,
      rejected: 1,
    });
    expect(report.detail).not.toContain("**");
  });
});

describe("HostSightingBuffer", () => {
  it("같은 호스트를 모으고 마지막 시각을 갱신한다", () => {
    const buffer = new HostSightingBuffer();
    expect(buffer.observe("acos.example", NOW)).toBe(true);
    expect(buffer.observe("acos.example:443", NOW + 1000)).toBe(true);
    const { sightings } = buffer.drain();
    expect(sightings).toEqual([
      {
        host: "acos.example",
        requests: 2,
        firstSeenAt: NOW,
        lastSeenAt: NOW + 1000,
      },
    ]);
  });

  /**
   * 오래된 것을 밀어내면, 새 이름을 계속 보내는 것만으로 진짜 관측을 지울
   * 수 있다 — 관측을 지우는 것은 보호를 지우는 것이다.
   */
  it("상한을 넘으면 새 이름을 받지 않는다 (밀어내지 않는다)", () => {
    const buffer = new HostSightingBuffer(2);
    buffer.observe("first.example", NOW);
    buffer.observe("second.example", NOW);
    expect(buffer.observe("third.example", NOW)).toBe(false);
    // 이미 담긴 이름은 계속 센다
    expect(buffer.observe("first.example", NOW)).toBe(true);
    const { sightings, full } = buffer.drain();
    expect(full).toBe(true);
    expect(sightings.map((row) => row.host).sort()).toEqual([
      "first.example",
      "second.example",
    ]);
  });

  it("버린 요청 수를 함께 돌려주고 비운다", () => {
    const buffer = new HostSightingBuffer();
    buffer.observe("<script>", NOW);
    buffer.observe("ok.example", NOW);
    expect(buffer.drain().rejected).toBe(1);
    expect(buffer.drain()).toEqual({ sightings: [], rejected: 0, full: false });
  });
});

describe("mergeSightings", () => {
  it("요청 수를 더하고 처음·마지막 시각을 넓힌다", () => {
    const merged = mergeSightings(
      [sighting("a.example", { requests: 5, firstSeenAt: 100, lastSeenAt: 200 })],
      [sighting("a.example", { requests: 3, firstSeenAt: 50, lastSeenAt: 300 })],
    );
    expect(merged).toEqual([
      { host: "a.example", requests: 8, firstSeenAt: 50, lastSeenAt: 300 },
    ]);
  });
});
