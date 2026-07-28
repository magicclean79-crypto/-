import {
  buildSessionClearCookie,
  buildSessionCookie,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
} from "./session-cookie";

describe("세션 쿠키 (TASK-0803)", () => {
  it("httpOnly 쿠키를 생성한다 — 기본 Lax, Secure 옵션", () => {
    const cookie = buildSessionCookie("tok123", {
      secure: false,
      sameSite: "Lax",
      maxAgeSeconds: 3600,
    });
    expect(cookie).toBe(
      `${SESSION_COOKIE_NAME}=tok123; Path=/; HttpOnly; Max-Age=3600; SameSite=Lax`,
    );

    expect(
      buildSessionCookie("tok123", {
        secure: true,
        sameSite: "Strict",
        maxAgeSeconds: 60,
      }),
    ).toContain("SameSite=Strict; Secure");
  });

  it("SameSite=None이면 Secure를 강제한다 (브라우저 규칙)", () => {
    const cookie = buildSessionCookie("tok", {
      secure: false,
      sameSite: "None",
      maxAgeSeconds: 10,
    });
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Secure");
  });

  it("삭제 쿠키는 Max-Age=0으로 즉시 만료된다", () => {
    const cookie = buildSessionClearCookie({ secure: false, sameSite: "Lax" });
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toContain("Max-Age=0");
  });

  it("Cookie 헤더를 파싱한다 — 공백/불량 쌍 무시", () => {
    expect(
      parseCookieHeader(`a=1; ${SESSION_COOKIE_NAME}=tok; broken; =x; b=2=2`),
    ).toEqual({ a: "1", [SESSION_COOKIE_NAME]: "tok", b: "2=2" });
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
  });
});
