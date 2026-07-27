import type { Metadata } from "next";
import Link from "next/link";
import type { ProductListItemDto } from "@acos/shared";

export const metadata: Metadata = {
  title: "상품 목록 | AI Product Content OS",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function fetchProducts(): Promise<ProductListItemDto[] | null> {
  try {
    const response = await fetch(`${API_URL}/products?take=50`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { products: ProductListItemDto[] };
    return body.products;
  } catch {
    return null;
  }
}

export default async function ProductsPage() {
  const products = await fetchProducts();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <div className="flex items-end justify-between">
        <div>
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            ← 홈으로
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">상품 목록</h1>
        </div>
        <Link
          href="/upload"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          📸 사진 업로드
        </Link>
      </div>

      {products === null && (
        <p className="text-zinc-500">
          상품 목록을 불러올 수 없습니다. API 서버가 실행 중인지 확인해 주세요.
        </p>
      )}
      {products?.length === 0 && (
        <p className="text-zinc-500">
          아직 상품이 없습니다. 사진을 업로드하고 첫 Product를 만들어 보세요.
        </p>
      )}

      {products && products.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <li key={product.id}>
              <Link
                href={`/products/${product.id}`}
                className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex h-36 items-center justify-center bg-zinc-100 dark:bg-zinc-800">
                  {product.thumbnailUrl ? (
                    <img
                      src={product.thumbnailUrl}
                      alt={product.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-3xl">📦</span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-4">
                  <h2 className="font-semibold">{product.name}</h2>
                  {product.description && (
                    <p className="line-clamp-2 text-sm text-zinc-500">
                      {product.description}
                    </p>
                  )}
                  <p className="mt-auto pt-2 text-xs text-zinc-400">
                    사진 {product.imageCount}장 ·{" "}
                    {product.createdAt.slice(0, 10)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
