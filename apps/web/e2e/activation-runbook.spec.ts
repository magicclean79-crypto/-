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
 * 운영 활성화 런북 · 신뢰 프록시 · 미귀속 경로 (TASK-4401, 정책 4401-①②⑤).
 *
 * 이번에 화면이 지켜야 하는 것: **되돌리는 법을 함께 보여 주는가**,
 * **읽지 못한 단계를 통과로 보여 주지 않는가**, 그리고 **어느 경로가
 * 빠뜨리는지 이름으로 말하는가**.
 */
test.describe("운영 활성화 런북 (TASK-4401)", () => {
  test("모든 단계에 되돌리는 법이 함께 보인다", async ({ page }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await open(page, "/admin/runbook");

    await expect(page.getByTestId("runbook-progress")).toHaveText("0/4 단계");
    await expect(page.getByTestId("runbook-rollback-preflight")).toContainText(
      "되돌릴 것이 없습니다",
    );
    await expect(page.getByTestId("runbook-rollback-credentials")).toContainText(
      "환경변수를 비우고",
    );
  });

  /**
   * 되돌리는 법을 문서로 미뤄 두면, 사고가 났을 때 그 자리에서 지어내게
   * 된다.
   */
  test("되돌릴 수 없는 단계를 그렇게 표시한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/runbook");

    await expect(page.getByTestId("runbook-irreversible-smoke")).toHaveText(
      "되돌릴 수 없음",
    );
    await expect(page.getByTestId("runbook-rollback-smoke")).toContainText(
      "이미 나간 호출은 취소되지 않습니다",
    );
  });

  test("상태를 읽지 못한 단계를 통과로 보여 주지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/runbook");

    await expect(page.getByTestId("runbook-state-observe")).toHaveText("확인 못 함");
    await expect(page.getByTestId("runbook-observe")).toContainText(
      "됐다는 뜻이 아닙니다",
    );
  });

  test("다음 단계와 사람이 줘야 하는 단계를 구분해 보여 준다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/runbook");

    await expect(page.getByTestId("runbook-next")).toHaveText("다음 단계");
    await expect(page.getByTestId("runbook-waiting")).toContainText(
      "사람이 줘야 하는 단계 1건",
    );
    await expect(page.getByTestId("runbook-source-preflight")).toHaveText(
      "GET /ops/readiness-board",
    );
  });

  /**
   * Host 헤더는 요청하는 쪽이 적는 값이다 — 선언 없이 전달 헤더를 보면
   * 누가 적었는지 모르는 이름이 관측에 들어간다.
   */
  test("프록시인 척한 요청을 화면에서 말한다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("trusted-proxy-declared")).toContainText(
      "프록시 경유 812건",
    );
    await expect(page.getByTestId("trusted-proxy-untrusted")).toContainText(
      "프록시인 척한 요청 2건",
    );
  });

  /**
   * 귀속률만 보면 "덜 됐다"까지만 알 수 있다.
   */
  test("어느 경로가 귀속을 빠뜨리는지 이름으로 보여 준다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/activation");

    await expect(page.getByTestId("attribution-verdict")).toContainText("목표 미달");
    await expect(page.getByTestId("attribution-llm:vision-analysis")).toContainText(
      "14건 중 12건 미귀속",
    );
    await expect(page.getByTestId("attribution-gap")).toContainText(
      "가장 많이 빠뜨리는 경로는 vision-analysis",
    );
  });
});
