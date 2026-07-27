export * from "./ocr";
export * from "./analysis";
export * from "./product-object";

import type { ContentDto, ContentStatus } from "@acos/shared";

const TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  DRAFT: ["REVIEW", "ARCHIVED"],
  REVIEW: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isPublishable(content: Pick<ContentDto, "title" | "body" | "status">): boolean {
  return content.status === "REVIEW" && content.title.length > 0 && content.body.length > 0;
}
