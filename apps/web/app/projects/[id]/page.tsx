import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  ContentDto,
  ProductObjectDto,
  ProjectDetailDto,
} from "@acos/shared";
import { Badge } from "@acos/ui";
import { PipelineActions } from "./pipeline-actions";

export const metadata: Metadata = {
  title: "프로젝트 상세 | AI Product Content OS",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await fetchJson<ProjectDetailDto>(`/projects/${id}`);
  if (!project) {
    notFound();
  }
  const [latestObject, contentsBody] = await Promise.all([
    fetchJson<ProductObjectDto>(`/projects/${id}/product-object`),
    fetchJson<{ contents: ContentDto[] }>(`/projects/${id}/contents`),
  ]);
  const contents = contentsBody?.contents ?? [];

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/projects"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 프로젝트 목록
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {project.name}
        </h1>
        {project.description && (
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            {project.description}
          </p>
        )}
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">파이프라인</h2>
          {latestObject ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <span>
                최신 Product Object v{latestObject.version} —{" "}
                {latestObject.title}
              </span>
              <Badge tone={latestObject.status === "READY" ? "ok" : "warn"}>
                {latestObject.status}
              </Badge>
            </div>
          ) : (
            <span className="text-sm text-zinc-500">
              Product Object 없음 — 조립을 실행하세요
            </span>
          )}
        </div>
        <PipelineActions
          projectId={project.id}
          latestVersion={latestObject?.version ?? null}
          latestStatus={latestObject?.status ?? null}
        />
      </section>

      <section>
        <h2 className="mb-3 font-semibold">
          상품 ({project.products.length})
        </h2>
        {project.products.length === 0 ? (
          <p className="text-sm text-zinc-500">
            아직 상품이 없습니다.{" "}
            <Link href="/upload" className="text-blue-600 hover:underline">
              사진을 업로드
            </Link>
            해 보세요.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {project.products.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/products/${product.id}`}
                  className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                >
                  {product.thumbnailUrl ? (
                    <img
                      src={product.thumbnailUrl}
                      alt={product.name}
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-100 text-xl dark:bg-zinc-800">
                      📦
                    </span>
                  )}
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-zinc-500">
                      사진 {product.imageCount}장
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">상세페이지 ({contents.length})</h2>
        {contents.length === 0 ? (
          <p className="text-sm text-zinc-500">
            아직 생성된 상세페이지가 없습니다. Product Object를 READY로 전환한
            뒤 생성해 보세요.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {contents.map((content) => (
              <li
                key={content.id}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <details>
                  <summary className="flex cursor-pointer items-center gap-2">
                    <span className="font-medium">{content.title}</span>
                    <Badge tone="warn">{content.status}</Badge>
                    <span className="text-xs text-zinc-400">
                      PO v{content.productObjectVersion ?? "-"} ·{" "}
                      {content.createdAt.slice(0, 16).replace("T", " ")}
                    </span>
                  </summary>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-4 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                    {content.body}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
