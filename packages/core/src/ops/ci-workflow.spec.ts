import { readFileSync } from "node:fs";
import { join } from "node:path";

import { judgeCiRuns, judgeCiWorkflow, REQUIRED_CI_GATES } from "./ci-workflow";

/**
 * CI 게이트 판정. (TASK-2201, CTO 결정 2101-③ · TASK-3401 CTO 지시 6)
 *
 * **Major Migration 교차 검증은 Build 이후에 둔다.** 검증 로직이
 * `@acos/core`에 있어 빌드 산출물이 필요하기 때문이다. 순서를 테스트로
 * 고정하는 이유는, 누군가 워크플로를 정리하다 앞으로 옮기면 **검증이 조용히
 * 실패하고**(모듈을 못 찾아 exit 2) 그것이 "판정 불가"로 취급되기 때문이다.
 *
 * TASK-3401에서 판정을 spec 밖(`judgeCiWorkflow`)으로 꺼냈다 — 같은 판정을
 * 운영 화면에서도 보여 주기 위해서다. 테스트에만 있는 규칙은 화면에서 보이지
 * 않고, 보이지 않는 규칙은 깨져도 아무도 모른다.
 */
describe("CI 워크플로 (TASK-2201, CTO 결정 2101-③)", () => {
  const workflow = readFileSync(
    join(__dirname, "..", "..", "..", "..", ".github", "workflows", "ci.yml"),
    "utf8",
  );

  it("실제 워크플로 파일이 판정을 통과한다", () => {
    const judged = judgeCiWorkflow(workflow);
    expect(judged.missing).toEqual([]);
    expect(judged.outOfOrder).toEqual([]);
    expect(judged.ok).toBe(true);
  });

  it("필수 게이트가 모두 들어 있다", () => {
    for (const gate of REQUIRED_CI_GATES) {
      expect(workflow).toContain(`run: ${gate.script}`);
    }
  });

  it("Major Migration 교차 검증이 Build 이후에 있다", () => {
    const build = workflow.indexOf("run: pnpm build");
    const check = workflow.indexOf("run: pnpm check:major-migrations");
    expect(build).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(build);
  });

  it("Lint·Test·TypeScript보다 앞에 있다 — 지정이 어긋난 채로 통과시키지 않는다", () => {
    const check = workflow.indexOf("run: pnpm check:major-migrations");
    expect(workflow.indexOf("run: pnpm lint")).toBeGreaterThan(check);
    expect(workflow.indexOf("run: pnpm test")).toBeGreaterThan(check);
    expect(workflow.indexOf("run: pnpm typecheck")).toBeGreaterThan(check);
  });

  /**
   * TASK-3501 (CTO 지시 4) — **게이트가 게이트를 검증한다.**
   *
   * 워크플로에서 게이트 한 줄이 사라져도 CI는 여전히 초록으로 끝난다:
   * 없어진 검사는 실패하지 않기 때문이다. TASK-3401에서 본 실패의 다른
   * 얼굴이다(그때는 적혀 있는데 돌지 않았고, 이번에 막는 것은 적혀 있지도
   * 않게 되는 것이다).
   */
  it("게이트 자체 검증 단계가 있다 (TASK-3501)", () => {
    expect(workflow).toContain("run: pnpm check:ci-gates");
  });

  it("동시 실행을 접고 시간 상한과 최소 권한을 둔다 (TASK-3501)", () => {
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("timeout-minutes:");
    expect(workflow).toContain("contents: read");
  });

  /**
   * TASK-3401에서 실제로 일어난 실패다. `pnpm test`는 web e2e(Playwright)를
   * 포함하는데 러너에 브라우저가 없어 **13회 실행이 전부 실패**했다. 게이트가
   * 파일에 적혀 있는 것과 초록으로 끝나는 것은 다르다.
   */
  it("Playwright 브라우저 설치 단계가 있다 (TASK-3401)", () => {
    expect(workflow).toContain("playwright install");
    expect(judgeCiWorkflow(workflow).browsersInstalled).toBe(true);
  });

  it("브라우저 설치가 빠지면 판정이 그 사실을 말한다", () => {
    const broken = workflow.replace(/.*playwright install.*\n/, "");
    const judged = judgeCiWorkflow(broken);
    expect(judged.ok).toBe(false);
    expect(judged.detail).toContain("브라우저");
  });

  it("게이트가 빠지면 무엇이 빠졌는지 말한다", () => {
    const judged = judgeCiWorkflow("- run: pnpm build\n");
    expect(judged.missing).toContain("ci-gates");
    expect(judged.missing).toContain("test");
    expect(judged.missing).toContain("lint");
    expect(judged.detail).toContain("빠진 게이트");
  });

  it("교차 검증을 Build 앞으로 옮기면 순서 위반으로 잡는다", () => {
    const judged = judgeCiWorkflow(
      [
        "- run: pnpm check:major-migrations",
        "- run: pnpm build",
        "- run: pnpm check:ci-gates",
        "- run: pnpm typecheck",
        "- run: pnpm lint",
        "- run: pnpm test",
        "- run: playwright install",
      ].join("\n"),
    );
    expect(judged.outOfOrder).toContain("major-migrations");
    expect(judged.ok).toBe(false);
  });
});

/**
 * 실행 결과 판정 (TASK-3401 — CTO 지시 6).
 *
 * 파일에 적혀 있는 것과 **초록으로 끝나는 것**은 다르다. 그리고 **한 번도 안
 * 돈 것**은 통과가 아니다.
 */
describe("CI 실행 결과 (TASK-3401)", () => {
  const run = (
    id: number,
    conclusion: string | null,
    createdAt: string,
    branch = "main",
  ) => ({
    id,
    branch,
    sha: `${id}`.padEnd(8, "0"),
    status: conclusion === null ? "in_progress" : "completed",
    conclusion,
    createdAt,
  });

  it("이력이 없으면 통과라고 말하지 않는다", () => {
    const judged = judgeCiRuns({ runs: [] });
    expect(judged.status).toBe("unknown");
    expect(judged.detail).toContain("한 번도 돌지 않은 것은");
  });

  it("가장 최근 실행이 통과면 green이다", () => {
    const judged = judgeCiRuns({
      runs: [
        run(1, "failure", "2026-07-30T01:00:00Z"),
        run(2, "success", "2026-07-30T02:00:00Z"),
      ],
    });
    expect(judged.status).toBe("green");
    expect(judged.consecutiveFailures).toBe(0);
  });

  it("연속 실패를 센다 — 계속 빨간 CI는 사실상 CI가 없는 것이다", () => {
    const judged = judgeCiRuns({
      runs: [
        run(1, "success", "2026-07-30T01:00:00Z"),
        run(2, "failure", "2026-07-30T02:00:00Z"),
        run(3, "failure", "2026-07-30T03:00:00Z"),
      ],
    });
    expect(judged.status).toBe("red");
    expect(judged.consecutiveFailures).toBe(2);
    expect(judged.detail).toContain("2회 연속");
  });

  it("진행 중이면 통과로도 실패로도 세지 않는다", () => {
    const judged = judgeCiRuns({
      runs: [run(1, null, "2026-07-30T03:00:00Z")],
    });
    expect(judged.status).toBe("running");
  });

  it("브랜치를 지정하면 그 브랜치만 본다", () => {
    const judged = judgeCiRuns({
      runs: [
        run(1, "failure", "2026-07-30T03:00:00Z", "other"),
        run(2, "success", "2026-07-30T02:00:00Z", "mine"),
      ],
      branch: "mine",
    });
    expect(judged.status).toBe("green");
    expect(judged.total).toBe(1);
  });
});
