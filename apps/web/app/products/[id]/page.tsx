import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ProductDetailDto } from "@acos/shared";
import { Badge } from "@acos/ui";

export const metadata: Metadata = {
  title: "상품 상세 | AI Product Content OS",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function fetchProduct(id: string): Promise<ProductDetailDto | null> {
  try {
    const response = await fetch(`${API_URL}/products/${id}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as ProductDetailDto;
  } catch {
    return null;
  }
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await fetchProduct(id);
  if (!product) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/products"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 상품 목록
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {product.name}
        </h1>
        {product.description && (
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            {product.description}
          </p>
        )}
        <p className="mt-2 text-xs text-zinc-400">
          생성 {product.createdAt.replace("T", " ").slice(0, 16)} · 사진{" "}
          {product.images.length}장
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {product.images.map((image) => (
          <li
            key={image.id}
            className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 sm:flex-row dark:border-zinc-800 dark:bg-zinc-900"
          >
            <img
              src={image.url}
              alt={image.originalName}
              className="h-40 w-full rounded-lg object-cover sm:w-56"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{image.originalName}</p>
                {image.ocr === null && <Badge tone="warn">OCR 미실행</Badge>}
                {image.ocr?.status === "COMPLETED" && (
                  <Badge tone="ok">
                    OCR {Math.round((image.ocr.confidence ?? 0) * 100)}%
                  </Badge>
                )}
                {image.ocr && image.ocr.status !== "COMPLETED" && (
                  <Badge tone="warn">OCR {image.ocr.status}</Badge>
                )}
              </div>
              {image.ocr?.text ? (
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                  {image.ocr.text}
                </pre>
              ) : (
                <p className="mt-2 text-sm text-zinc-500">
                  추출된 텍스트가 없습니다.
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
