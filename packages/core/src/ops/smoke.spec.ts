import { judgeSmokeProbe, summarizeSmoke } from "./smoke";
import type { SmokeProbe } from "./smoke";

/**
 * 운영 스모크 판정 검증. (TASK-3701 — CTO 정책 3701-②)
 *
 * 가장 중요한 한 줄: **스텁을 상대로 한 200은 통과가 아니다.** TASK-3401
 * 라이브 검증에서 화면이 스텁 22건을 근거로 "연결됨"이라고 말했던 사고가
 * 정확히 그것이었다.
 */
describe("운영 스모크 (TASK-3701)", () => {
  const probe = (overrides: Partial<SmokeProbe>): SmokeProbe => ({
    target: "llm",
    provider: "openai",
    baseUrl: "https://api.openai.com",
    attempted: true,
    ok: true,
    latencyMs: 320,
    detail: "응답 수신",
    ...overrides,
  });

  it("공식 주소로 성공하면 통과다", () => {
    expect(judgeSmokeProbe(probe({})).status).toBe("passed");
  });

  it("스텁을 상대로 성공한 것은 통과가 아니다", () => {
    const result = judgeSmokeProbe(probe({ baseUrl: "http://127.0.0.1:9100" }));
    expect(result.status).toBe("stubbed");
    expect(result.detail).toContain("공식 주소가 아닙니다");
    expect(result.next).toContain("공식 주소로 다시");
  });

  it("호출 대상을 모르면 통과로 세지 않는다 — null은 '공식이었다'가 아니다", () => {
    expect(judgeSmokeProbe(probe({ baseUrl: null })).status).toBe("stubbed");
  });

  it("실패는 실패다", () => {
    const result = judgeSmokeProbe(
      probe({ ok: false, detail: "401 invalid_api_key" }),
    );
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("401");
  });

  it("길이 막힌 실패는 키 문제로 읽히지 않게 그 사실을 먼저 말한다", () => {
    // 라이브 검증에서 실제로 겪은 것: `403 Host not in allowlist`(프록시)가
    // 그냥 "실패"로만 떴고, 그걸 본 사람은 **키**를 먼저 의심하게 된다.
    const result = judgeSmokeProbe(
      probe({
        ok: false,
        detail: "403 Host not in allowlist: api.openai.com",
        pathStatus: "ambiguous",
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("길이 막힌 것은 다릅니다");
    expect(result.next).toContain("먼저 여세요");
  });

  it("막힌 길에서는 길을 먼저 열라고 말한다", () => {
    const result = judgeSmokeProbe(
      probe({ ok: false, detail: "ETIMEDOUT", pathStatus: "blocked" }),
    );
    expect(result.detail).toContain("막혀 있습니다");
  });

  it("길이 열려 있으면 실패 사유를 그대로 읽으라고 한다 — 없는 핑계를 만들지 않는다", () => {
    const result = judgeSmokeProbe(
      probe({ ok: false, detail: "401 invalid_api_key", pathStatus: "reachable" }),
    );
    expect(result.detail).toBe("401 invalid_api_key");
    expect(result.next).toContain("실제로 불러야만");
  });

  it("길 상태를 모르면 아무 말도 덧붙이지 않는다 — 모르는 것을 지어내지 않는다", () => {
    const result = judgeSmokeProbe(
      probe({ ok: false, detail: "500 server_error", pathStatus: null }),
    );
    expect(result.detail).toBe("500 server_error");
  });

  it("부르지 않은 것은 통과가 아니다", () => {
    const result = judgeSmokeProbe(
      probe({ attempted: false, provider: "mock", detail: "LLM_PROVIDER=mock" }),
    );
    expect(result.status).toBe("skipped");
    expect(result.next).toContain("부르지 않은 것은 통과가 아닙니다");
  });

  describe("저장소", () => {
    it("Amazon S3를 상대로 성공해야 통과다", () => {
      expect(
        judgeSmokeProbe(
          probe({
            target: "storage",
            provider: "s3",
            baseUrl: "https://s3.ap-northeast-2.amazonaws.com",
          }),
        ).status,
      ).toBe("passed");
    });

    it("MinIO·s3rver는 프로토콜이 같을 뿐 다른 시스템이다", () => {
      expect(
        judgeSmokeProbe(
          probe({ target: "storage", provider: "s3", baseUrl: "http://127.0.0.1:9000" }),
        ).status,
      ).toBe("stubbed");
    });
  });

  describe("요약", () => {
    it("셋 다 통과해야 ok다 — 부분 점수는 없다", () => {
      const results = [
        judgeSmokeProbe(probe({})),
        judgeSmokeProbe(
          probe({ target: "ocr", provider: "google-vision", baseUrl: "https://vision.googleapis.com" }),
        ),
        judgeSmokeProbe(
          probe({ target: "storage", provider: "s3", baseUrl: "http://127.0.0.1:9000" }),
        ),
      ];
      const summary = summarizeSmoke(results);
      expect(summary.passed).toBe(2);
      expect(summary.total).toBe(3);
      expect(summary.ok).toBe(false);
      expect(summary.detail).toContain("스텁 응답이라 통과로 세지 않음");
    });

    it("빈 결과는 ok가 아니다 — 아무것도 안 한 것은 통과가 아니다", () => {
      expect(summarizeSmoke([]).ok).toBe(false);
    });

    it("셋 다 공식 주소로 성공하면 그렇게 말한다", () => {
      const summary = summarizeSmoke([
        judgeSmokeProbe(probe({})),
        judgeSmokeProbe(
          probe({ target: "ocr", provider: "google-vision", baseUrl: "https://vision.googleapis.com" }),
        ),
        judgeSmokeProbe(
          probe({
            target: "storage",
            provider: "s3",
            baseUrl: "https://s3.ap-northeast-2.amazonaws.com",
          }),
        ),
      ]);
      expect(summary.ok).toBe(true);
      expect(summary.detail).toContain("세 대상 모두");
    });
  });
});
