import {
  generateSessionToken,
  hashPassword,
  roleAtLeast,
  verifyPassword,
} from "./auth";

describe("인증 Foundation (TASK-0801)", () => {
  it("비밀번호 해시/검증 왕복 — salt가 매번 달라도 검증된다", async () => {
    const first = await hashPassword("secret-password-1");
    const second = await hashPassword("secret-password-1");

    expect(first).toMatch(/^scrypt:\d+:[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(first).not.toBe(second); // salt 개별 생성
    expect(await verifyPassword("secret-password-1", first)).toBe(true);
    expect(await verifyPassword("secret-password-1", second)).toBe(true);
  });

  it("잘못된 비밀번호·손상된 해시는 거부한다", async () => {
    const stored = await hashPassword("correct-password");
    expect(await verifyPassword("wrong-password", stored)).toBe(false);
    expect(await verifyPassword("x", "plain:bad")).toBe(false);
    expect(await verifyPassword("x", "scrypt:abc:salt:00")).toBe(false);
  });

  it("세션 토큰은 256비트 hex이며 매번 다르다", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(generateSessionToken()).not.toBe(token);
  });

  it("RBAC 역할 계층 — ADMIN > EDITOR > VIEWER", () => {
    expect(roleAtLeast("ADMIN", "ADMIN")).toBe(true);
    expect(roleAtLeast("ADMIN", "VIEWER")).toBe(true);
    expect(roleAtLeast("EDITOR", "EDITOR")).toBe(true);
    expect(roleAtLeast("EDITOR", "ADMIN")).toBe(false);
    expect(roleAtLeast("VIEWER", "EDITOR")).toBe(false);
  });
});
