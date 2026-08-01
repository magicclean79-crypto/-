import { ENV_SPECS } from "@acos/core";

import { isCookieOnly, isHealthProtected, sessionCookieOptions } from "./session-config";

/**
 * 세션 쿠키 보안 기본값. (TASK-4801 — v1.0 Release Candidate)
 *
 * ## 왜 이 파일이 생겼는가
 *
 * v1.0 출시 점검에서 **선언과 코드가 서로 다른 말을 하고 있는 것**을
 * 잡았습니다. `ENV_SPECS`의 `AUTH_COOKIE_SECURE`는 "운영에서는 자동 활성"
 * 이라고 적혀 있었는데, `sessionCookieOptions()`는 `?? false`였습니다.
 *
 * 그리고 그 차이는 **조용했습니다** — 미설정일 때 환경 검증이 경고조차
 * 내지 않았습니다. 운영에 올린 사람은 선언을 읽고 "켜져 있겠지"라고 믿을
 * 근거가 있었고, 확인할 방법은 없었습니다.
 *
 * 그래서 이 파일은 값 하나를 검사하는 것이 아니라 **선언과 코드가 같은
 * 말을 하는지**를 검사합니다.
 */

const KEYS = [
  "NODE_ENV",
  "AUTH_COOKIE_SECURE",
  "AUTH_COOKIE_ONLY",
  "AUTH_PROTECT_HEALTH",
] as const;

describe("세션 쿠키 보안 기본값 (TASK-4801)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  /**
   * 운영은 쿠키 전용 모드가 기본이다 — 그러면 세션 쿠키가 **유일한 자격
   * 증명**이고, Secure가 없으면 그것이 평문 경로로 나갈 수 있다.
   */
  it("운영에서는 지정하지 않아도 Secure가 켜진다", () => {
    process.env.NODE_ENV = "production";
    expect(sessionCookieOptions().secure).toBe(true);
    // 같은 환경에서 쿠키 전용 모드도 켜져 있다 — 그래서 이 쿠키가
    // 유일한 자격 증명이 된다
    expect(isCookieOnly()).toBe(true);
  });

  it("스테이징에서도 켜진다", () => {
    process.env.NODE_ENV = "staging";
    expect(sessionCookieOptions().secure).toBe(true);
  });

  /** 개발은 HTTP다 — 여기서 켜면 로그인 자체가 안 된다 */
  it("개발에서는 켜지 않는다", () => {
    process.env.NODE_ENV = "development";
    expect(sessionCookieOptions().secure).toBe(false);
  });

  /**
   * 끄는 것은 됩니다 — HTTP로만 서비스하는 내부망 스테이징이 있습니다.
   * **모르는 채로 꺼져 있는 것**이 문제였습니다.
   */
  it("명시적으로 끄면 꺼진다", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_COOKIE_SECURE = "0";
    expect(sessionCookieOptions().secure).toBe(false);
  });

  it("명시적으로 켜면 개발에서도 켜진다", () => {
    process.env.NODE_ENV = "development";
    process.env.AUTH_COOKIE_SECURE = "1";
    expect(sessionCookieOptions().secure).toBe(true);
  });

  /**
   * **이 검사가 이 파일의 이유입니다.** 선언이 "자동 활성"이라고 적혀
   * 있으면 코드도 그래야 합니다. 둘이 어긋나면 운영자는 문서를 읽고
   * 틀린 것을 믿게 되고, 그 사실을 확인할 방법이 없습니다.
   */
  it("선언(ENV_SPECS)과 코드가 같은 말을 한다", () => {
    const spec = ENV_SPECS.find((entry) => entry.name === "AUTH_COOKIE_SECURE");
    expect(spec).toBeDefined();
    expect(spec?.fallback).toContain("자동 활성");

    process.env.NODE_ENV = "production";
    expect(sessionCookieOptions().secure).toBe(true);
  });

  /** 세 보호 장치가 같은 기준으로 켜진다 — 하나만 다르면 그게 사고다 */
  it("쿠키 전용·health 보호와 같은 기준으로 켜진다", () => {
    process.env.NODE_ENV = "production";
    expect(sessionCookieOptions().secure).toBe(true);
    expect(isCookieOnly()).toBe(true);
    expect(isHealthProtected()).toBe(true);

    process.env.NODE_ENV = "development";
    expect(sessionCookieOptions().secure).toBe(false);
    expect(isCookieOnly()).toBe(false);
    expect(isHealthProtected()).toBe(false);
  });
});
