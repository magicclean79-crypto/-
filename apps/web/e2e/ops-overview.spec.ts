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
 * 통합 운영 대시보드 (TASK-4601, CTO 정책 4601-④⑤).
 *
 * 화면이 지켜야 하는 것: **한 줄 요약이 못 본 것을 감추지 않는가**,
 * **확인 못 한 칸을 정상 옆에 조용히 두지 않는가**, **인용처를 달고
 * 다니는가**, 그리고 **조용한 채널을 도달로 보여 주지 않는가**.
 */
test.describe("통합 운영 상태 (TASK-4601)", () => {
  /**
   * 못 읽은 갈래를 뒤에 붙이면 "정상 3 · 확인 못 함 1"의 앞부분만 읽히고,
   * 그 한 줄은 거짓말이 된다.
   */
  test("못 읽은 갈래를 요약 문장에서 먼저 말한다", async ({ page }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await open(page, "/admin/overview");

    const detail = await page.getByTestId("overview-detail").innerText();
    expect(detail.startsWith("1개 갈래를 읽지 못했습니다")).toBe(true);
    await expect(page.getByTestId("overview-unread")).toHaveText(
      "읽지 못한 갈래 1개",
    );
  });

  /**
   * 라이브에서 잡은 결함: 표본이 모자라 판정을 유보한 갈래를 "읽지
   * 못했다"고 적었다. 칸은 "판정하지 않았습니다"라고 말하는데 요약은
   * "못 읽었다"고 말했다 — 같은 사실에 두 개의 답이다.
   */
  test("못 읽은 것과 판정을 유보한 것을 가른다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/overview");

    await expect(page.getByTestId("overview-undecided")).toHaveText("판정 유보 1개");
    await expect(page.getByTestId("overview-tile-status-attribution")).toHaveText(
      "판정 유보",
    );
    await expect(page.getByTestId("overview-tile-status-recovery")).toHaveText(
      "읽지 못함",
    );
    await expect(page.getByTestId("overview-detail")).toContainText(
      "판정을 유보했습니다(Attribution)",
    );
  });

  test("네 갈래를 모으고 각 칸이 출처와 질문을 달고 있다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/overview");

    await expect(page.getByTestId("overview-tile-source-validation")).toHaveText(
      "GET /ops/go-live",
    );
    await expect(page.getByTestId("overview-tile-source-notification")).toHaveText(
      "GET /ops/notifications/health",
    );
    await expect(page.getByTestId("overview-tile-recovery")).toContainText(
      "잘못됐을 때 되돌릴 수 있는가",
    );
  });

  /**
   * 확인 못 한 칸이 정상 옆에서 조용하면, 모르는 갈래가 많은 환경이
   * 건강해 보인다.
   */
  test("확인 못 한 갈래를 통과처럼 보여 주지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/overview");

    const unknown = page.getByTestId("overview-tile-status-recovery");
    await expect(unknown).toHaveText("읽지 못함");
    await expect(unknown).toHaveClass(/border/);
    await expect(page.getByTestId("overview-status")).toHaveText("실패");
  });

  /**
   * 3주 전에 한 번 닿은 채널과 지금 닿는 채널이 같은 초록으로 보이면,
   * 만료된 주소를 다음 장애 때 알게 된다.
   */
  test("조용한 채널을 도달로 보여 주지 않는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/overview");

    await expect(page.getByTestId("channel-verdict-webhook")).toHaveText("도달");
    const teams = page.getByTestId("channel-verdict-teams");
    await expect(teams).toHaveText("확인 안 됨");
    await expect(teams).toHaveClass(/border/);
    await expect(page.getByTestId("channel-teams")).toContainText("가릴 수 없습니다");
  });

  /**
   * 오타 하나로 담당자 한 명이 조용히 빠지는 것을 아무도 모르면 안 된다.
   */
  test("읽지 못한 담당자 선언을 화면에 적는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/overview");

    await expect(page.getByTestId("owner-contacts")).toContainText("이름만");
  });

  /**
   * 확인하지 않은 형식을 기본값으로 두면, 그 형식이 틀렸다는 사실을 첫
   * 장애 때 알게 된다.
   */
  test("Teams 본문 형식과 되돌리는 법을 적는다", async ({ page }) => {
    await setMode("data");
    await open(page, "/admin/overview");

    await expect(page.getByTestId("teams-format")).toContainText(
      "되돌리는 것도 같은 한 줄",
    );
  });

  test("로그인 없이는 읽을 수 없다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/overview");
    await expect(page.getByTestId("overview-error")).toContainText(
      "ADMIN 로그인이 필요합니다",
    );
  });
});
