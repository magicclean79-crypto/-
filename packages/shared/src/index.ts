export const APP_NAME = "AI Product Content OS";

export type HealthStatus = "OK" | "DEGRADED" | "DOWN";

export type ContentStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED";

export interface ProductDto {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
}

export interface ContentDto {
  id: string;
  title: string;
  body: string;
  status: ContentStatus;
  productId: string;
  createdAt: string;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
