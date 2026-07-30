/**
 * 발행 시각의 두 가지 의미. (TASK-2801, Sprint 28 — CTO 결정 2701-②)
 *
 * `publishedAt`은 **최초 발행 시각**이다(TASK-0703 승인 ②). 그 결정은
 * 그대로 유지된다 — "이 콘텐츠가 언제 세상에 처음 나왔는가"는 나중에
 * 되돌릴 수 없는 사실이고, 재발행할 때마다 덮어쓰면 그 사실이 사라진다.
 *
 * 그런데 `ARCHIVED → DRAFT` 되살리기를 연 뒤(결정 2601-①) **재발행이 공식
 * 절차**가 되면서 최초 발행 시각 하나로는 답할 수 없는 질문이 생겼다:
 * **"이 콘텐츠는 지금 언제부터 나가 있는가."** 내렸다 고쳐 다시 올린
 * 콘텐츠는 최초 발행 시각만 보면 옛 날짜를 보여 주고, 그 날짜는 지금
 * 나가 있는 본문과 아무 관계가 없다 — **상태와 설명이 어긋난다.**
 *
 * 그래서 `lastPublishedAt`을 따로 둔다. 둘의 역할은 겹치지 않는다:
 *
 * | 값 | 뜻 | 언제 바뀌는가 |
 * | --- | --- | --- |
 * | `publishedAt` | 최초 발행 시각 | **한 번만** 기록되고 이후 바뀌지 않는다 |
 * | `lastPublishedAt` | 지금 나가 있는 본문이 나간 시각 | **발행할 때마다** |
 */

/** 콘텐츠의 발행 시각 두 값 */
export interface PublishTimestamps {
  /** 최초 발행 시각 — 한 번 기록되면 바뀌지 않는다 */
  publishedAt: Date | null;
  /**
   * 마지막 발행 시각.
   *
   * `null`인데 `publishedAt`이 있으면 **모르는 것**이다 — 이 값을 두기 전에
   * 발행된 콘텐츠이고, 그 사이에 재발행이 있었는지 알 수 없다.
   */
  lastPublishedAt: Date | null;
}

/** 발행 전이에서 갱신할 시각 필드 */
export interface PublishTimestampUpdate {
  /** 최초 발행일 때만 담긴다 — 이미 있으면 건드리지 않는다 */
  publishedAt?: Date;
  /** 발행할 때마다 갱신된다 */
  lastPublishedAt: Date;
}

/**
 * `PUBLISHED` 전이에서 무엇을 기록할지 정한다 (순수 함수).
 *
 * **최초 발행 시각은 이미 있으면 손대지 않는다** — 재발행이 최초를 덮어쓰면
 * "언제 처음 나갔는가"에 다시는 답할 수 없다(CTO 결정 2701-②).
 */
export function resolvePublishTimestamps(
  current: Pick<PublishTimestamps, "publishedAt">,
  now: Date,
): PublishTimestampUpdate {
  return {
    ...(current.publishedAt === null ? { publishedAt: now } : {}),
    lastPublishedAt: now,
  };
}

/**
 * 재발행된 콘텐츠인가.
 *
 * 판정할 수 없으면 `null`이다 — 마지막 발행 시각을 두기 전에 발행된
 * 콘텐츠는 재발행 여부를 알 수 없고, **모르는 것을 "아니다"로 답하면**
 * 화면이 거짓을 말한다.
 */
export function isRepublished(times: PublishTimestamps): boolean | null {
  if (times.publishedAt === null) {
    return false; // 나간 적이 없으면 재발행도 없다
  }
  if (times.lastPublishedAt === null) {
    return null; // 이 값을 두기 전에 발행됨 — 알 수 없다
  }
  return times.lastPublishedAt.getTime() > times.publishedAt.getTime();
}

/**
 * 발행 시각을 사람이 읽을 한 줄로.
 *
 * 두 값이 같으면 한 번만 말한다 — 같은 날짜를 두 번 적으면 읽는 사람이
 * 무엇이 다른지 찾느라 시간을 쓴다.
 */
export function describePublishTimeline(times: PublishTimestamps): string {
  if (times.publishedAt === null) {
    return "발행된 적이 없습니다.";
  }
  const first = times.publishedAt.toISOString();
  const republished = isRepublished(times);
  if (republished === null) {
    return (
      `최초 발행 ${first} — 마지막 발행 시각은 기록되지 않았습니다 ` +
      "(이 값을 두기 전에 발행된 콘텐츠입니다)."
    );
  }
  if (!republished) {
    return `최초 발행 ${first} — 이후 재발행 없음.`;
  }
  return `최초 발행 ${first} · 마지막 발행 ${times.lastPublishedAt!.toISOString()} (재발행됨).`;
}
