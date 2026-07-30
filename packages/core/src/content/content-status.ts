import type { ContentDto, ContentStatus } from "@acos/shared";

/**
 * Content 발행 파이프라인 상태 전이 규칙. (Sprint 1 선언 → TASK-0703에서
 * 발행 API로 공식 사용)
 *
 * DRAFT → REVIEW → PUBLISHED → ARCHIVED
 *   ↑        │                     │
 *   └────────┘ (되돌리기)          └─▶ DRAFT (되살리기, TASK-2701)
 *
 * **`ARCHIVED → DRAFT`를 연 이유** (CTO 결정 2601-①): 이미 발행된 콘텐츠에
 * 위반이 발견됐을 때의 공식 절차가 **`PUBLISHED → ARCHIVED → 수정 →
 * 재발행`**으로 확정됐다. 그런데 `ARCHIVED`가 종결이면 그 절차의 "수정 →
 * 재발행"을 밟을 수 없다 — 절차를 정해 두고 코드가 막고 있으면 사람은
 * 새 콘텐츠를 만들어 우회하고, 그러면 **왜 내렸는지가 새 콘텐츠에 남지
 * 않는다.** 별도 상태(`SUSPENDED`)를 만들지 않기로 한 결정과 함께 보면,
 * 되살리는 길은 `ARCHIVED → DRAFT` 하나여야 한다.
 *
 * **`ARCHIVED → PUBLISHED`는 열지 않는다.** 되살린 것은 `DRAFT`에서
 * `REVIEW`를 거쳐 다시 발행해야 하고, 그래야 **거버넌스 게이트가 다시
 * 돈다**(TASK-2501). 내린 이유를 고치지 않은 채 곧바로 되돌아가는 길을
 * 열면 내린 것이 아무 의미가 없다.
 */
const TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  DRAFT: ["REVIEW", "ARCHIVED"],
  REVIEW: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED"],
  // 되살리기만 — 발행으로 직행하는 길은 없다 (게이트를 우회하게 된다)
  ARCHIVED: ["DRAFT"],
};

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** 상태별 허용 전이 목록 — 오류 메시지 안내용 */
export function allowedTransitions(from: ContentStatus): ContentStatus[] {
  return [...TRANSITIONS[from]];
}

/** 발행 가능 조건 — REVIEW 상태 + 제목/본문이 비어 있지 않아야 한다 */
export function isPublishable(
  content: Pick<ContentDto, "title" | "body" | "status">,
): boolean {
  return (
    content.status === "REVIEW" &&
    content.title.length > 0 &&
    content.body.length > 0
  );
}
