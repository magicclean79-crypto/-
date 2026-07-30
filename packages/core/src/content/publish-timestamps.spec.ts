import {
  describePublishTimeline,
  isRepublished,
  resolvePublishTimestamps,
} from "./publish-timestamps";

const at = (iso: string) => new Date(iso);
const FIRST = at("2026-07-01T00:00:00.000Z");
const LATER = at("2026-07-30T00:00:00.000Z");

describe("발행 시각 (TASK-2801, CTO 결정 2701-②)", () => {
  describe("최초 발행 시각은 바뀌지 않는다", () => {
    it("첫 발행에는 둘 다 기록한다", () => {
      expect(
        resolvePublishTimestamps({ publishedAt: null }, FIRST),
      ).toEqual({ publishedAt: FIRST, lastPublishedAt: FIRST });
    });

    it("재발행에는 마지막 발행 시각만 갱신한다", () => {
      const update = resolvePublishTimestamps({ publishedAt: FIRST }, LATER);
      // 최초 시각을 덮어쓰면 "언제 처음 나갔는가"에 다시는 답할 수 없다
      expect(update.publishedAt).toBeUndefined();
      expect(update.lastPublishedAt).toBe(LATER);
    });

    it("몇 번을 다시 발행해도 최초 시각 필드는 담기지 않는다", () => {
      for (const now of [LATER, at("2026-08-01T00:00:00.000Z")]) {
        expect(
          "publishedAt" in resolvePublishTimestamps({ publishedAt: FIRST }, now),
        ).toBe(false);
      }
    });
  });

  describe("재발행 여부", () => {
    it("마지막 발행이 최초보다 늦으면 재발행이다", () => {
      expect(
        isRepublished({ publishedAt: FIRST, lastPublishedAt: LATER }),
      ).toBe(true);
    });

    it("같은 시각이면 재발행이 아니다", () => {
      expect(
        isRepublished({ publishedAt: FIRST, lastPublishedAt: FIRST }),
      ).toBe(false);
    });

    it("발행된 적이 없으면 재발행도 없다", () => {
      expect(
        isRepublished({ publishedAt: null, lastPublishedAt: null }),
      ).toBe(false);
    });

    it("마지막 발행 시각을 두기 전에 발행된 것은 **모른다** — false가 아니다", () => {
      // 모르는 것을 "재발행 없음"으로 답하면 화면이 거짓을 말한다
      expect(
        isRepublished({ publishedAt: FIRST, lastPublishedAt: null }),
      ).toBeNull();
    });
  });

  describe("문구", () => {
    it("나간 적이 없으면 그렇게 말한다", () => {
      expect(
        describePublishTimeline({ publishedAt: null, lastPublishedAt: null }),
      ).toBe("발행된 적이 없습니다.");
    });

    it("한 번만 발행했으면 날짜를 두 번 적지 않는다", () => {
      const text = describePublishTimeline({
        publishedAt: FIRST,
        lastPublishedAt: FIRST,
      });
      expect(text).toContain("이후 재발행 없음");
      expect(text.match(/2026-07-01/g)).toHaveLength(1);
    });

    it("재발행이면 두 시각을 함께 말한다", () => {
      const text = describePublishTimeline({
        publishedAt: FIRST,
        lastPublishedAt: LATER,
      });
      expect(text).toContain("최초 발행 2026-07-01");
      expect(text).toContain("마지막 발행 2026-07-30");
      expect(text).toContain("재발행됨");
    });

    it("알 수 없을 때는 '기록되지 않았다'고 말한다", () => {
      const text = describePublishTimeline({
        publishedAt: FIRST,
        lastPublishedAt: null,
      });
      expect(text).toContain("기록되지 않았습니다");
      // "재발행 없음"이라고 단정하지 않는다
      expect(text).not.toContain("재발행 없음");
    });

    it("어떤 조합에서도 마크다운 강조가 새지 않는다", () => {
      for (const times of [
        { publishedAt: null, lastPublishedAt: null },
        { publishedAt: FIRST, lastPublishedAt: FIRST },
        { publishedAt: FIRST, lastPublishedAt: LATER },
        { publishedAt: FIRST, lastPublishedAt: null },
      ]) {
        expect(describePublishTimeline(times)).not.toContain("**");
      }
    });
  });
});
