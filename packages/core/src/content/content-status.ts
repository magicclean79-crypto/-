import type { ContentDto, ContentStatus } from "@acos/shared";

/**
 * Content 발행 파이프라인 상태 전이 규칙. (Sprint 1 선언 → TASK-0703에서
 * 발행 API로 공식 사용)
 *
 * DRAFT → REVIEW → PUBLISHED → ARCHIVED
 *   ↑        │
 *   └────────┘ (REVIEW → DRAFT 되돌리기)
 * DRAFT/REVIEW/PUBLISHED → ARCHIVED(종결), ARCHIVED에서는 전이 불가.
 */
const TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  DRAFT: ["REVIEW", "ARCHIVED"],
  REVIEW: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED"],
  ARCHIVED: [],
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
