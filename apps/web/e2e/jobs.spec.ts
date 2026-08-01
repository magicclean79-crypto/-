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
 * 작업 현황 (TASK-4603 — 프로덕션 품질).
 *
 * 화면이 지켜야 하는 것: **원문을 사용자에게 보여 주지 않는가**,
 * **이어할 수 없는 실패에 버튼을 두지 않는가**, **표본이 모자란 추세를
 * 빠르다고 말하지 않는가**.
 */
test.describe("작업 현황 (TASK-4603)", () => {
  test("작업이 어디까지 갔고 왜 멈췄는지 보여 준다", async ({ page }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await open(page, "/admin/jobs");

    await expect(page.getByTestId("job-job-timeout")).toContainText("2/5 단계");
    await expect(page.getByTestId("job-status-job-timeout")).toHaveText("실패");
    await expect(page.getByTestId("job-job-timeout")).toContainText(
      "체크포인트에 남아 있어 이어할 수 있습니다",
    );
  });

  /**
   * 원문에 무엇이 들어 있는지 우리는 미리 알 수 없다 — 원문은 로그에만 있다.
   */
  test("사용자 문장을 보여 주고 원문을 보여 주지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/jobs");

    await expect(page.getByTestId("job-message-job-timeout")).toHaveText(
      "처리 시간이 예상보다 길어져 중단했습니다. 잠시 후 다시 시도해 주세요.",
    );
    const text = await page.locator("main").innerText();
    expect(text).not.toContain("Error:");
    expect(text).not.toContain("at /");
  });

  /**
   * 눌러도 같은 결과가 나오는 버튼은 없느니만 못하다.
   */
  test("이어할 수 없는 실패에는 이어하기 버튼이 없다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/jobs");

    await expect(page.getByTestId("job-resume-job-timeout")).toBeVisible();
    await expect(page.getByTestId("job-resume-job-blocked")).toHaveCount(0);
    await expect(page.getByTestId("job-job-blocked")).toContainText(
      "원인을 먼저 고쳐 주세요",
    );
  });

  /**
   * 한 번 느렸던 것을 "느린 단계"로 적으면 그날의 흔들림이 영구 결함으로
   * 남는다.
   */
  test("표본이 모자란 단계를 빠르다고 말하지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/jobs");

    await expect(page.getByTestId("trend-verdict-ocr:*")).toHaveText("느림");
    const undecided = page.getByTestId("trend-verdict-fetch:*");
    await expect(undecided).toHaveText("판정 유보");
    await expect(page.getByTestId("job-metrics")).toContainText(
      "빠르다는 뜻이 아닙니다",
    );
  });

  /**
   * 사람이 로그와 화면을 맞춰 볼 수 있어야 한다.
   */
  test("요청 id를 함께 보여 준다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/jobs");

    await expect(page.getByTestId("job-job-timeout")).toContainText("요청 req-abcd");
  });


  /**
   * 자동 이어하기는 **아무도 안 보는 사이에 돈을 씁니다.** 그래서 화면이
   * 켜져 있는지, 무엇을 이어할 줄 아는지, 무엇은 자동으로 안 하는지를
   * 함께 말해야 합니다 (TASK-4701, 지시 3).
   */
  test("자동 이어하기가 켜져 있는지와 그 한계를 함께 말한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/jobs");

    await expect(page.getByTestId("job-queue-detail")).toContainText(
      "자동 이어하기가 켜져 있습니다",
    );
    await expect(page.getByTestId("job-queue")).toContainText("analysis-batch");
    // 켜져 있어도 아무거나 이어하지 않는다는 사실을 같은 자리에서 말한다
    await expect(page.getByTestId("job-queue")).toContainText(
      "다시 해도 같은 실패는 자동으로 돌리지 않습니다",
    );
    await expect(page.getByTestId("job-queue")).toContainText("목록에 남습니다");
  });

  /**
   * 서버가 멈춰 남은 작업은 **실패가 아니라 "끝났는지 모른다"** 입니다.
   * 실패로 칠하면 사람이 원인을 찾으러 가고, 성공으로 칠하면 아무도 안
   * 이어합니다 (TASK-4701).
   */
  test("서버가 멈춘 작업을 실패로 칠하지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/jobs");

    await expect(page.getByTestId("job-status-job-interrupted")).toHaveText(
      "서버가 멈춤",
    );
    await expect(page.getByTestId("job-job-interrupted")).toContainText(
      "이어할 수 있습니다",
    );
    // 이어하기 버튼이 있어야 한다 — 끝난 단계는 체크포인트에 남아 있다
    await expect(page.getByTestId("job-resume-job-interrupted")).toBeVisible();
  });

  test("로그인 없이는 읽을 수 없다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/jobs");
    await expect(page.getByTestId("jobs-error")).toContainText(
      "ADMIN 로그인이 필요합니다",
    );
  });
});
