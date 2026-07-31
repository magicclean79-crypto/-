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
 * 비용·방치 화면 (TASK-4201, CTO 정책 4201-①②④).
 *
 * 이번에 화면이 지켜야 하는 것: **목록이 낡았다는 사실을 말하는가**,
 * **오래 방치된 것을 최소값으로 읽게 하는가**, 그리고 무엇보다
 * **귀속되지 않은 비용을 프로젝트에 나눠 얹지 않는가**.
 */
test.describe("비용·방치 (TASK-4201)", () => {
  test("목록에 없는데 쓰이는 호스트를 사람에게 묻는다", async ({ page }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("hosts-undeclared")).toContainText(
      "목록에 없는 호스트 1개",
    );
    await expect(page.getByTestId("host-verdict-cdn.acos.example")).toHaveText(
      "목록에 없음",
    );
    await expect(page.getByTestId("production-hosts")).toContainText(
      "자동으로 넣지 않는 이유는",
    );
  });

  test("오래 방치된 항목을 최소값으로 읽게 한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("neglect-worst")).toContainText("23일째");
    await expect(page.getByTestId("streak-truncated-storage")).toHaveText("최소값");
    await expect(page.getByTestId("neglect-section")).toContainText(
      "실패 수가 늘지 않았다고 나아진 것이 아닙니다",
    );
  });

  test("연속이 짧은 항목에는 최소값 표시가 없다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("streak-urgent-channel")).toContainText("2회 연속");
    await expect(page.getByTestId("streak-truncated-urgent-channel")).toHaveCount(0);
  });

  /**
   * 이 시험이 정책 ④의 핵심이다 — 미배분을 프로젝트에 나눠 얹으면 표는
   * 깔끔해지지만 그 숫자는 만들어낸 것이고, 그걸로 팀에 비용을 청구하게 된다.
   */
  test("귀속되지 않은 비용을 프로젝트에 나눠 얹지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("cost-unattributed")).toContainText(
      "어느 프로젝트에도 더하지 않았습니다",
    );
    await expect(page.getByTestId("project-cost")).toContainText(
      "만들어낸 것이 됩니다",
    );
    // 미배분을 나눴다면 이 프로젝트의 비율이 100%가 됐을 것이다
    await expect(page.getByTestId("cost-proj-1")).toContainText("30%");
  });

  test("귀속률이 100%가 아니면 적게 청구된다고 말한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("cost-coverage")).toContainText("귀속률 40%");
    await expect(page.getByTestId("cost-caveat")).toContainText(
      "실제 사용량보다 적게 청구됩니다",
    );
  });

  test("금액을 모르는 것과 주인을 모르는 것을 가른다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("cost-unpriced-proj-1")).toContainText(
      "미산정 3건 — 최소값",
    );
    await expect(page.getByTestId("project-cost")).toContainText(
      "주인을 모르는 것과 다른 문제입니다",
    );
  });
});
