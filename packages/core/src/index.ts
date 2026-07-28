export * from "./ocr";
export * from "./analysis";
export * from "./product-object";
export * from "./vision";
export * from "./content";
export * from "./sop";
export * from "./workflow";
export * from "./decision";
export * from "./project-memory";
export * from "./memory";
export * from "./knowledge";
export * from "./ready-validation";
export * from "./llm";
export * from "./content-generation";
export * from "./prompt";
export * from "./execution";

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
