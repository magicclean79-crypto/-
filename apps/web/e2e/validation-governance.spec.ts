import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

async function open(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

/**
 * 검증 거버넌스 화면 (TASK-4101, CTO 정책 4101-②③④⑤⑥).
 *
 * 이번에 화면이 지켜야 하는 것: **어느 환경의 이야기인지 밝히는가**,
 * **오늘 새로 나빠진 것과 계속 나빴던 것을 가르는가**, **없어진 검사를
 * 복구로 적지 않는가**, **막힌 이유를 그대로 보여 주는가**, 그리고
 * **늦게 본 것을 성과로 적지 않는가**.
 */
test.describe("검증 거버넌스 (TASK-4101)", () => {
  test("어느 배포 단계의 진단인지 밝힌다", async ({ page }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("diagnostics-tier")).toHaveText("스테이징");
    await expect(page.getByTestId("diagnostics-section")).toContainText("[스테이징]");
  });

  test("새로 나빠진 것과 계속 나빴던 것을 가른다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("diagnostics-comparison")).toContainText(
      "지난 진단 이후에 바뀐 것이 있다는 뜻입니다",
    );
    await expect(page.getByTestId("diagnostics-regressed")).toContainText(
      "새로 나빠진 항목 1건",
    );
  });

  test("없어진 검사를 복구로 적지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("diagnostics-disappeared")).toContainText(
      "검사 자체가 없어진 것입니다",
    );
    await expect(page.getByTestId("diagnostics-comparison")).toContainText(
      "없어진 검사는 실패하지 않습니다",
    );
  });

  test("검증 실행이 막힌 이유를 그대로 보여 준다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("run-verdict")).toHaveText("막혀 있습니다");
    await expect(page.getByTestId("validation-run")).toContainText(
      "강제로 여는 방법은 없습니다",
    );
    await expect(page.getByTestId("run-blockers")).toContainText(
      "코드로 해결되지 않습니다",
    );
  });

  test("주소를 적는 것과 돌려도 된다고 말하는 것을 가른다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("run-target-verdict")).toContainText(
      "staging.acos.example",
    );
    await expect(page.getByTestId("validation-run")).toContainText(
      "다른 행동입니다",
    );
  });

  test("되돌릴 수 없는 단계를 표시한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("run-irreversible-smoke")).toHaveText(
      "되돌릴 수 없음",
    );
    // 앞의 단계들은 읽기·시험이므로 그 표시가 없다
    await expect(page.getByTestId("run-irreversible-preflight")).toHaveCount(0);
  });

  test("늦게 본 것을 성과로 적지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("draft-revivals")).toContainText(
      "잘 처리한 기록이 아니라",
    );
    await expect(page.getByTestId("revival-item")).toContainText("만료 23일 뒤");
  });
});
