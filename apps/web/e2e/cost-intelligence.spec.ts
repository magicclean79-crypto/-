import { expect, test } from "@playwright/test";

const STUB = "http://localhost:4999";

async function setMode(mode: string): Promise<void> {
  await fetch(`${STUB}/__mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

async function openPage(page: import("@playwright/test").Page) {
  await page.goto("/admin/costs");
  await page.evaluate(() => localStorage.setItem("acos_token", "stub-token"));
  await page.reload();
}

/** 제안 등록 (OCR 단가) */
async function propose(
  page: import("@playwright/test").Page,
  reason: string,
  perUnit = "0.002",
) {
  await page.getByTestId("pricing-per-unit").fill(perUnit);
  await page.getByTestId("pricing-reason").fill(reason);
  await page.getByTestId("pricing-propose").click();
}

test.describe("AI 비용 관리 (TASK-3101)", () => {
  test("가격표·예측·리포트를 한 화면에서 성격까지 함께 보여준다", async ({
    page,
  }) => {
    // 이 라우트를 처음 여는 테스트라 개발 서버 최초 컴파일 시간을 흡수한다
    test.slow();
    await setMode("data");
    await openPage(page);

    // 실효 가격표 — 지금 계산에 쓰는 단가와 그 출처
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "OCR google-vision",
    );
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "단위당 $0.0015",
    );
    // 승인된 단가와 코드 기본값은 화면에서 구분된다
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "코드 기본값 — 승인 이력이 없습니다",
    );
    await expect(page.getByTestId("pricing-board")).toContainText(
      "과거 비용 기록은 바뀌지 않습니다",
    );

    // 예측은 참고자료다 (정책 3101-③)
    const forecast = page.getByTestId("cost-forecast");
    await expect(forecast).toContainText("참고자료");
    await expect(forecast).toContainText("예산 차단은 실제 비용만 사용합니다");
    await expect(forecast).toContainText("$62.000000");

    // 리포트는 운영 지표다 (정책 3101-④)
    await expect(page.getByTestId("billing-report")).toContainText("운영 지표");
    await expect(page.getByTestId("billing-disclaimer")).toContainText(
      "회계 청구서를 대체하지 않습니다",
    );
    await expect(page.getByTestId("billing-rows")).toContainText("gpt-4o");
    // 미산정은 숨기지 않는다 — 총액이 실제보다 작다는 뜻이다
    await expect(page.getByTestId("billing-rows")).toContainText("미산정 1");
  });

  test("검토 없이 승인할 수 없다 — 거절 사유를 화면이 그대로 말한다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    await propose(page, "2026-07 단가 공지 반영");
    const open = page.getByTestId("open-proposals");
    await expect(open).toContainText("작성됨");
    await expect(open).toContainText("단위당 $0.0015 → 단위당 $0.002");
    // DRAFT에서 누를 수 있는 것은 "검토 완료"뿐이다 (승인 버튼이 없다)
    await expect(open.getByRole("button", { name: "검토 완료" })).toBeVisible();
    await expect(open.getByRole("button", { name: "승인" })).toHaveCount(0);
  });

  test("검토 → 승인 → 적용을 거치면 실효 가격표가 바뀐다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await propose(page, "2026-07 단가 공지 반영");
    await page.getByRole("button", { name: "검토 완료" }).click();
    await expect(page.getByTestId("open-proposals")).toContainText("검토됨");

    await page.getByRole("button", { name: "승인" }).click();
    // 제안자와 승인자가 같은 사실은 남기되 막지 않는다
    await expect(page.getByTestId("self-approval-warning")).toContainText(
      "제안자와 승인자가 같습니다",
    );

    await page.getByRole("button", { name: "적용" }).click();
    await expect(page.getByTestId("costs-note")).toContainText(
      "과거 비용 기록은 바뀌지 않습니다",
    );
    // 적용 뒤에야 계산에 쓰인다 — 그 사실과 출처가 함께 남는다
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "단위당 $0.002",
    );
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "승인된 제안으로 적용됨",
    );
    await expect(page.getByTestId("closed-proposals")).toContainText("적용됨");
  });

  test("사유 없는 제안은 등록되지 않고 이유가 보인다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await page.getByTestId("pricing-per-unit").fill("0.002");
    await page.getByTestId("pricing-propose").click();
    await expect(page.getByTestId("costs-error")).toContainText("변경 사유");
  });

  test("표본이 적으면 숫자를 만들지 않고, 모른다고 말한다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    const forecast = page.getByTestId("cost-forecast");
    await expect(forecast).toContainText("표본 부족");
    await expect(forecast).toContainText("최소 3일이 필요합니다");
    // 예상은 비우고 실제 지출은 그대로 말한다
    await expect(forecast).toContainText("미산정");
    await expect(forecast).toContainText("$3.000000");
    await expect(forecast).toContainText("추정도 실제보다 작을 수 있습니다");
  });

  test("빈 기간에도 면책 문구는 남는다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    await expect(page.getByTestId("billing-report")).toContainText(
      "집계된 호출이 없습니다",
    );
    await expect(page.getByTestId("billing-disclaimer")).toContainText(
      "회계 청구서를 대체하지 않습니다",
    );
  });

  test("ADMIN 전용이다 — 단가는 돈의 기준이다", async ({ page }) => {
    await setMode("data");
    await page.goto("/admin/costs");
    await expect(page.getByTestId("costs-error")).toContainText(
      "ADMIN 권한이 필요합니다",
    );
  });
});

test.describe("가격 자동화 (TASK-3201)", () => {
  test("감지된 제안은 출처와 근거를 함께 보여준다 (CTO 정책 3201-①)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    await page.getByTestId("pricing-detect").click();
    await expect(page.getByTestId("costs-note")).toContainText(
      "감지만으로 단가는 바뀌지 않습니다",
    );

    const open = page.getByTestId("open-proposals");
    await expect(open).toContainText("감지됨");
    // 자동화가 만든 제안을 사람이 낸 것으로 읽지 않게 한다
    await expect(page.getByTestId("origin-detected")).toBeVisible();
    // 근거 없는 제안은 승인할 수 없다
    await expect(page.getByTestId("proposal-evidence")).toContainText("표본 5건");
    // 제안자가 "알 수 없음"이 아니라 시스템이다 — 모르는 것과 사람이 아닌
    // 것은 다르다 (라이브 화면에서 "제안 알 수 없음"으로 보이던 것을 갈랐다)
    await expect(open).toContainText("제안 시스템 (자동 감지)");
    // 감지가 검토를 대신한다 — 바로 승인 버튼이 뜬다
    await expect(open.getByRole("button", { name: "승인" })).toBeVisible();
    await expect(open.getByRole("button", { name: "검토 완료" })).toHaveCount(0);

    // 감지만으로는 실효 가격표가 바뀌지 않는다
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "단위당 $0.0015",
    );
  });

  test("감지된 제안을 승인하면 사람의 확인이 1회라는 사실을 밝힌다", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    await page.getByTestId("pricing-detect").click();
    await page.getByRole("button", { name: "승인" }).click();
    await expect(page.getByTestId("self-approval-warning")).toContainText(
      "사람의 확인은 1회입니다",
    );
  });

  test("발효 시각을 예약하면 그때까지 이전 단가로 계산한다 (CTO 정책 3201-③)", async ({
    page,
  }) => {
    await setMode("data");
    await openPage(page);

    await propose(page, "8월 1일부터 인상 공지");
    await page.getByRole("button", { name: "검토 완료" }).click();
    await page.getByRole("button", { name: "승인" }).click();

    // 적용은 결정이고 발효는 시각이다
    const later = new Date(Date.now() + 3 * 86_400_000);
    const local = new Date(later.getTime() - later.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    await page.getByTestId("pricing-effective-from").fill(local);
    await page.getByRole("button", { name: "적용" }).click();

    await expect(page.getByTestId("costs-note")).toContainText("예약");
    await expect(page.getByTestId("scheduled-pricing")).toContainText(
      "아직 계산에 쓰이지 않습니다",
    );
    // 실효 가격표는 그대로다
    await expect(page.getByTestId("effective-pricing")).toContainText(
      "단위당 $0.0015",
    );
  });

  test("과거 시점 적용은 거부되고 이유가 보인다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await propose(page, "소급 적용 시도");
    await page.getByRole("button", { name: "검토 완료" }).click();
    await page.getByRole("button", { name: "승인" }).click();

    const past = new Date(Date.now() - 3 * 86_400_000);
    const local = new Date(past.getTime() - past.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    await page.getByTestId("pricing-effective-from").fill(local);
    await page.getByRole("button", { name: "적용" }).click();

    await expect(page.getByTestId("costs-error")).toContainText(
      "과거 시점으로 적용할 수 없습니다",
    );
  });

  test("예측은 경보만 낸다고 화면이 말한다 (CTO 정책 3201-④)", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const forecast = page.getByTestId("cost-forecast");
    await expect(forecast).toContainText("경보만");
    await expect(forecast).toContainText("호출은 막히지 않습니다");
  });

  test("단가를 가를 수 없는 어긋남은 직접 제안을 내라고 말한다", async ({ page }) => {
    // LLM은 입력·출력 단가를 기록만으로 나눌 수 없다 — 숫자를 지어내지 않는다
    await setMode("empty");
    await openPage(page);

    await page.getByTestId("pricing-detect").click();
    await expect(page.getByTestId("costs-note")).toContainText(
      "단가를 가를 수 없어 제안을 만들지 않았습니다",
    );
  });
});

test.describe("Provider Intelligence (TASK-3301)", () => {
  test("공지를 못 읽으면 '변경 없음'이 아니라고 화면이 말한다 (CTO 정책 3301-①)", async ({
    page,
  }) => {
    await setMode("empty");
    await openPage(page);

    await page.getByTestId("pricing-detect").click();
    const warning = page.getByTestId("price-source-warning");
    await expect(warning).toContainText("변경이 없다는 뜻이 아닙니다");
    // 못 읽은 항목을 버리지 않는다 — 아홉을 읽었다고 성공이 아니다
    await expect(warning).toContainText("clova");
    await expect(page.getByTestId("costs-note")).toContainText(
      "사람이 직접 확인해 주세요",
    );
  });

  test("공지 기반 제안의 근거는 표본이 아니라 공지다", async ({ page }) => {
    // 출처마다 근거의 모양이 다르다 — 한 모양으로 읽으면 없는 필드에서
    // 화면이 깨진다 (라이브에서 실제로 그렇게 깨졌다)
    await setMode("published");
    await openPage(page);

    await page.getByTestId("pricing-detect").click();
    await expect(page.getByTestId("origin-published")).toBeVisible();
    await expect(page.getByTestId("proposal-evidence")).toContainText(
      "가격 공지",
    );
    await expect(page.getByTestId("proposal-evidence")).toContainText(
      "공지 발효",
    );
    // 출처가 늘어도 제안자는 "알 수 없음"이 아니다
    await expect(page.getByTestId("open-proposals")).toContainText(
      "제안 시스템 (가격 공지)",
    );
  });

  test("공지를 다 읽으면 경고가 없다", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await page.getByTestId("pricing-detect").click();
    await expect(page.getByTestId("price-source-warning")).toHaveCount(0);
  });

  test("시스템 제안은 최종 승인을 거친다 (CTO 정책 3301-②)", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await page.getByTestId("pricing-detect").click();
    await page.getByRole("button", { name: "승인" }).click();

    // 승인 뒤에 바로 적용 버튼이 뜨지 않는다 — 최종 승인이 남았다
    await expect(page.getByTestId("second-approval-note")).toContainText(
      "다른 ADMIN의 최종 승인이 필요합니다",
    );
    const open = page.getByTestId("open-proposals");
    await expect(open.getByRole("button", { name: "최종 승인" })).toBeVisible();
    await expect(open.getByRole("button", { name: "적용" })).toHaveCount(0);

    await page.getByRole("button", { name: "최종 승인" }).click();
    await expect(open).toContainText("최종 승인됨");
    await expect(open.getByRole("button", { name: "적용" })).toBeVisible();
  });

  test("예약 취소는 삭제가 아니다 (CTO 정책 3301-③)", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    await propose(page, "9월 인상 공지");
    await page.getByRole("button", { name: "검토 완료" }).click();
    await page.getByRole("button", { name: "승인" }).click();
    const later = new Date(Date.now() + 5 * 86_400_000);
    const local = new Date(later.getTime() - later.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    await page.getByTestId("pricing-effective-from").fill(local);
    await page.getByRole("button", { name: "적용" }).click();
    await expect(page.getByTestId("scheduled-pricing")).toBeVisible();

    await page.getByTestId("cancel-schedule").click();
    await expect(page.getByTestId("costs-note")).toContainText(
      "기록은 남습니다",
    );
    // 예약은 사라지고 기록은 남는다
    await expect(page.getByTestId("scheduled-pricing")).toHaveCount(0);
    await expect(page.getByTestId("closed-proposals")).toContainText(
      "예약 취소됨",
    );
  });

  test("감지 주기는 Provider별로만 설정한다 (CTO 정책 3301-④)", async ({ page }) => {
    await setMode("data");
    await openPage(page);

    const status = page.getByTestId("detection-status");
    await expect(status).toContainText("google-vision");
    await expect(status).toContainText("6시간");
    // 안 본 것과 보고 조용한 것은 다르다
    await expect(status).toContainText("아직 보지 않음");
    await expect(page.getByTestId("pricing-board")).toContainText(
      "프로젝트별 설정은 지원하지 않습니다",
    );
  });

  test("프로젝트별 설정 시도는 거부 사유가 보인다", async ({ page }) => {
    await setMode("empty");
    await openPage(page);

    await expect(page.getByTestId("detection-rejected")).toContainText(
      "프로젝트별 감지 주기는 지원하지 않습니다",
    );
  });
});
