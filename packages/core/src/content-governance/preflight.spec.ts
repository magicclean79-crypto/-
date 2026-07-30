import {
  DEFAULT_GOVERNANCE_ARCHIVE_AFTER_DAYS,
  describeGovernanceArchive,
  describePreflight,
  isReleased,
  planGovernanceArchive,
  resolveGovernanceArchiveAfterDays,
  summarizePreflight,
} from "./preflight";
import type { PreflightItem } from "./preflight";

function item(overrides: Partial<PreflightItem> = {}): PreflightItem {
  return {
    contentId: "c-1",
    projectId: "proj-1",
    title: "순한 주방세제",
    contentStatus: "REVIEW",
    status: "PASS",
    blockedBy: [],
    warnings: [],
    ...overrides,
  };
}

describe("Governance Preflight Scan (TASK-2601, CTO 결정 2501-①)", () => {
  it("검사할 것이 없으면 그렇게 말한다", () => {
    const result = summarizePreflight([]);
    expect(result.summary.scanned).toBe(0);
    expect(result.items).toEqual([]);
    expect(describePreflight(result)).toBe("검사할 콘텐츠가 없습니다.");
  });

  it("위반이 없으면 목록이 비고, 위반 없음이라고 말한다", () => {
    const result = summarizePreflight([item(), item({ contentId: "c-2" })]);
    expect(result.summary).toMatchObject({
      scanned: 2,
      blocked: 0,
      publishedViolations: 0,
      warned: 0,
      clean: 2,
    });
    expect(result.items).toEqual([]);
    expect(describePreflight(result)).toContain("위반 없음");
  });

  it("통과한 것은 목록에 담지 않는다 — 담으면 고칠 것이 묻힌다", () => {
    const result = summarizePreflight([
      item({ contentId: "clean" }),
      item({
        contentId: "bad",
        status: "FAIL",
        blockedBy: ["banned-words"],
      }),
    ]);
    expect(result.items.map((entry) => entry.contentId)).toEqual(["bad"]);
    expect(result.summary.scanned).toBe(2);
  });

  describe("이미 나간 것과 막을 수 있는 것을 나누어 센다", () => {
    it("아직 발행 안 된 위반은 '발행이 막힐 것'이다", () => {
      const result = summarizePreflight([
        item({
          contentStatus: "REVIEW",
          status: "FAIL",
          blockedBy: ["banned-words"],
        }),
        item({
          contentId: "c-2",
          contentStatus: "DRAFT",
          status: "FAIL",
          blockedBy: ["disclosures"],
        }),
      ]);
      expect(result.summary.blocked).toBe(2);
      expect(result.summary.publishedViolations).toBe(0);
      expect(describePreflight(result)).toContain("발행이 막힐 것 2건");
    });

    it("이미 발행된 위반은 따로 센다 — 막을 수 없다", () => {
      const result = summarizePreflight([
        item({
          contentStatus: "PUBLISHED",
          status: "FAIL",
          blockedBy: ["banned-words"],
        }),
      ]);
      expect(result.summary.publishedViolations).toBe(1);
      expect(result.summary.blocked).toBe(0);
      const detail = describePreflight(result);
      // 발행 게이트는 나가는 것을 막지만 이미 나간 것에는 힘이 없다
      expect(detail).toContain("이미 발행된 위반 1건");
      expect(detail).toContain("내려야 합니다");
    });

    it("이미 나간 위반을 먼저 말한다 — 막을 수 없는 것이 더 급하다", () => {
      const detail = describePreflight(
        summarizePreflight([
          item({
            contentId: "todo",
            contentStatus: "REVIEW",
            status: "FAIL",
            blockedBy: ["banned-words"],
          }),
          item({
            contentId: "out",
            contentStatus: "PUBLISHED",
            status: "FAIL",
            blockedBy: ["banned-words"],
          }),
        ]),
      );
      expect(detail.indexOf("이미 발행된 위반")).toBeLessThan(
        detail.indexOf("발행이 막힐 것"),
      );
    });

    it("이미 나간 위반이 목록에서도 앞에 온다", () => {
      const result = summarizePreflight([
        item({
          contentId: "todo",
          contentStatus: "REVIEW",
          status: "FAIL",
          blockedBy: ["banned-words"],
        }),
        item({
          contentId: "out",
          contentStatus: "PUBLISHED",
          status: "FAIL",
          blockedBy: ["banned-words"],
        }),
      ]);
      expect(result.items.map((entry) => entry.contentId)).toEqual([
        "out",
        "todo",
      ]);
    });

    it("ARCHIVED·DRAFT·REVIEW는 나간 것이 아니다", () => {
      expect(isReleased("PUBLISHED")).toBe(true);
      for (const status of ["DRAFT", "REVIEW", "ARCHIVED"] as const) {
        expect(isReleased(status)).toBe(false);
      }
    });
  });

  it("주의만 있는 것은 막히는 것과 섞지 않는다", () => {
    const result = summarizePreflight([
      item({ status: "WARNING", warnings: ["source-object"] }),
      item({
        contentId: "c-2",
        status: "FAIL",
        blockedBy: ["banned-words"],
        warnings: ["source-object"],
      }),
    ]);
    expect(result.summary).toMatchObject({ blocked: 1, warned: 1, clean: 0 });
  });

  it("검사별로 집계한다 — 무엇을 먼저 고칠지 판단하는 근거", () => {
    const result = summarizePreflight([
      item({ contentId: "a", status: "FAIL", blockedBy: ["banned-words"] }),
      item({ contentId: "b", status: "FAIL", blockedBy: ["banned-words"] }),
      item({ contentId: "c", status: "FAIL", blockedBy: ["disclosures"] }),
      item({ contentId: "d", status: "WARNING", warnings: ["source-object"] }),
    ]);
    expect(result.summary.byCheck).toEqual([
      { key: "banned-words", blocked: 2, warned: 0 },
      { key: "disclosures", blocked: 1, warned: 0 },
      { key: "source-object", blocked: 0, warned: 1 },
    ]);
  });

  it("심한 것부터 정렬한다", () => {
    const result = summarizePreflight([
      item({ contentId: "warn", status: "WARNING", warnings: ["source-object"] }),
      item({
        contentId: "fail",
        status: "FAIL",
        blockedBy: ["banned-words", "disclosures"],
      }),
    ]);
    expect(result.items.map((entry) => entry.contentId)).toEqual([
      "fail",
      "warn",
    ]);
  });

  describe("목록을 자르되 조용히 자르지 않는다", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      item({
        contentId: `c-${index}`,
        status: "FAIL",
        blockedBy: ["banned-words"],
      }),
    );

    it("요약의 숫자는 자르기 전 전체다", () => {
      const result = summarizePreflight(many, { limit: 2 });
      // 2건만 보여 주면서 "위반 2건"이라고 하면 실제 건수를 아무도 모른다
      expect(result.summary.scanned).toBe(5);
      expect(result.summary.blocked).toBe(5);
      expect(result.items).toHaveLength(2);
      expect(result.truncated).toBe(true);
      expect(result.omitted).toBe(3);
    });

    it("잘랐다는 사실과 생략 건수를 문구에 적는다", () => {
      const detail = describePreflight(summarizePreflight(many, { limit: 2 }));
      expect(detail).toContain("발행이 막힐 것 5건");
      // 몇 번째를 보고 있는지까지 적는다 (TASK-2701 페이지)
      expect(detail).toContain("5건 중 1~2번째");
      expect(detail).toContain("3건 생략");
    });

    it("자르지 않았으면 잘랐다고 하지 않는다", () => {
      const result = summarizePreflight(many, { limit: 10 });
      expect(result.truncated).toBe(false);
      expect(result.omitted).toBe(0);
      expect(describePreflight(result)).not.toContain("생략");
    });
  });

  describe("페이지 (TASK-2701, CTO 결정 2601-④)", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      item({
        contentId: `c-${index}`,
        status: "FAIL",
        blockedBy: ["banned-words"],
      }),
    );

    it("Summary는 항상 전체 기준이다 — 페이지와 무관하다", () => {
      for (const offset of [0, 2, 4]) {
        const result = summarizePreflight(many, { limit: 2, offset });
        // 한 페이지에 2건이 보인다고 위반이 2건인 것이 아니다
        expect(result.summary.scanned).toBe(5);
        expect(result.summary.blocked).toBe(5);
        expect(result.page.total).toBe(5);
      }
    });

    it("offset만큼 건너뛴다", () => {
      const first = summarizePreflight(many, { limit: 2, offset: 0 });
      const second = summarizePreflight(many, { limit: 2, offset: 2 });
      expect(first.items.map((entry) => entry.contentId)).toEqual([
        "c-0",
        "c-1",
      ]);
      expect(second.items.map((entry) => entry.contentId)).toEqual([
        "c-2",
        "c-3",
      ]);
    });

    it("마지막 페이지에서 hasMore가 꺼진다", () => {
      expect(summarizePreflight(many, { limit: 2, offset: 0 }).page.hasMore).toBe(
        true,
      );
      expect(summarizePreflight(many, { limit: 2, offset: 4 }).page.hasMore).toBe(
        false,
      );
    });

    it("페이지를 이어 붙이면 전체가 된다 — 빠지거나 겹치지 않는다", () => {
      const seen: string[] = [];
      for (let offset = 0; offset < 5; offset += 2) {
        seen.push(
          ...summarizePreflight(many, { limit: 2, offset }).items.map(
            (entry) => entry.contentId,
          ),
        );
      }
      expect(seen).toEqual(["c-0", "c-1", "c-2", "c-3", "c-4"]);
      expect(new Set(seen).size).toBe(5);
    });

    it("범위를 넘는 offset은 빈 페이지이고 전체 수는 그대로다", () => {
      const result = summarizePreflight(many, { limit: 2, offset: 99 });
      expect(result.items).toEqual([]);
      expect(result.page.total).toBe(5);
      expect(result.page.offset).toBe(5);
      expect(result.page.hasMore).toBe(false);
      // 다 건너뛴 것도 "생략"이다 — 요약은 여전히 전체를 말한다
      expect(result.omitted).toBe(5);
      expect(result.summary.blocked).toBe(5);
    });

    it("문구가 몇 번째를 보고 있는지 말한다", () => {
      const detail = describePreflight(
        summarizePreflight(many, { limit: 2, offset: 2 }),
      );
      expect(detail).toContain("5건 중 3~4번째");
    });
  });

  it("문구가 상태를 바꾸지 않는다는 것을 매번 밝힌다 (CTO 결정 2501-①)", () => {
    const detail = describePreflight(
      summarizePreflight([
        item({ status: "FAIL", blockedBy: ["banned-words"] }),
      ]),
    );
    expect(detail).toContain("상태를 바꾸지 않고 고치지도 않습니다");
  });

  it("판정 문구에 마크다운 강조가 새지 않는다", () => {
    for (const candidate of [
      summarizePreflight([]),
      summarizePreflight([item()]),
      summarizePreflight(
        [
          item({ status: "FAIL", blockedBy: ["banned-words"] }),
          item({
            contentId: "out",
            contentStatus: "PUBLISHED",
            status: "FAIL",
            blockedBy: ["disclosures"],
          }),
          item({ contentId: "w", status: "WARNING", warnings: ["source-object"] }),
        ],
        { limit: 1 },
      ),
    ]) {
      expect(describePreflight(candidate)).not.toContain("**");
    }
  });
});

describe("판정 기록 보관 (TASK-2601, CTO 결정 2501-⑤)", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1_800_000_000_000;

  it("기본 유예는 90일 — 경보와 같은 정책이다", () => {
    expect(DEFAULT_GOVERNANCE_ARCHIVE_AFTER_DAYS).toBe(90);
    expect(resolveGovernanceArchiveAfterDays({})).toBe(90);
  });

  it("환경변수로 바꿀 수 있다", () => {
    expect(
      resolveGovernanceArchiveAfterDays({
        GOVERNANCE_ARCHIVE_AFTER_DAYS: "30",
      }),
    ).toBe(30);
  });

  it("해석할 수 없거나 0 이하면 기본값 — 즉시 보관되는 것보다 안전하다", () => {
    for (const raw of ["", "  ", "곧", "0", "-5", "NaN"]) {
      expect(
        resolveGovernanceArchiveAfterDays({
          GOVERNANCE_ARCHIVE_AFTER_DAYS: raw,
        }),
      ).toBe(90);
    }
  });

  it("작성 시각을 기준으로 센다 — 판정 기록에는 해소가 없다", () => {
    const plan = planGovernanceArchive({ afterDays: 90, now });
    expect(plan.cutoff).toBe(now - 90 * day);
    expect(plan.afterDays).toBe(90);
  });

  it("보관은 삭제가 아니라고 매번 밝힌다", () => {
    const detail = describeGovernanceArchive(7, 90);
    expect(detail).toContain("7건");
    expect(detail).toContain("90일");
    expect(detail).toContain("삭제하지 않습니다");
    expect(detail).not.toContain("**");
  });
});
