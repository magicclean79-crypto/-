import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CI 게이트 순서 고정. (TASK-2201, CTO 결정 2101-③)
 *
 * **Major Migration 교차 검증은 Build 이후에 둔다.** 검증 로직이
 * `@acos/core`에 있어 빌드 산출물이 필요하기 때문이다.
 *
 * 순서를 테스트로 고정하는 이유는, 누군가 워크플로를 정리하다 앞으로 옮기면
 * **검증이 조용히 실패하고**(모듈을 못 찾아 exit 2) 그것이 "판정 불가"로
 * 취급되기 때문이다. 기록되지 않는 규칙은 지켜지지 않는다.
 */
describe("CI 워크플로 (TASK-2201, CTO 결정 2101-③)", () => {
  const workflow = readFileSync(
    join(__dirname, "..", "..", "..", "..", ".github", "workflows", "ci.yml"),
    "utf8",
  );

  const stepIndex = (needle: string) => workflow.indexOf(needle);

  it("Major Migration 교차 검증이 Build 이후에 있다", () => {
    const build = stepIndex("run: pnpm build");
    const check = stepIndex("run: pnpm check:major-migrations");
    expect(build).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(build);
  });

  it("Lint·Test보다 앞에 있다 — 지정이 어긋난 채로 통과시키지 않는다", () => {
    const check = stepIndex("run: pnpm check:major-migrations");
    expect(stepIndex("run: pnpm lint")).toBeGreaterThan(check);
    expect(stepIndex("run: pnpm test")).toBeGreaterThan(check);
  });

  it("네 게이트가 모두 들어 있다", () => {
    for (const step of [
      "run: pnpm build",
      "run: pnpm check:major-migrations",
      "run: pnpm lint",
      "run: pnpm test",
    ]) {
      expect(workflow).toContain(step);
    }
  });
});
