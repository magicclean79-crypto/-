import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  ContentDto,
  ContentGovernanceDto,
  ContentStatusHistoryDto,
  GovernancePreflightDto,
  ProductObjectDto,
  ProjectDetailDto,
} from "@acos/shared";
import { Badge } from "@acos/ui";
import { ContentGovernancePanel } from "./content-governance";
import { GovernancePreflightPanel } from "./governance-preflight";
import { ContentStatusActions } from "./content-status-actions";
import { ContentStatusBadge } from "./content-status";
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
  const [latestObject, contentsBody, preflight] = await Promise.all([
    fetchJson<ProductObjectDto>(`/projects/${id}/product-object`),
    fetchJson<{ contents: ContentDto[] }>(`/projects/${id}/contents`),
    // 발행 위반 스캔 (TASK-2601) — 이미 나간 것까지 함께 본다.
    // 조회는 상태를 바꾸지 않으므로 화면을 여는 것만으로 안전하다.
    fetchJson<GovernancePreflightDto>(
      `/projects/${id}/governance/preflight?status=DRAFT,REVIEW,PUBLISHED`,
    ),
  ]);
  const contents = contentsBody?.contents ?? [];
  // 발행 감사 이력 (TASK-0704) — 콘텐츠별 병렬 조회
  const histories = new Map(
    await Promise.all(
      contents.map(
        async (content) =>
          [
            content.id,
            (
              await fetchJson<{ history: ContentStatusHistoryDto[] }>(
                `/projects/${id}/contents/${content.id}/history`,
              )
            )?.history ?? [],
          ] as const,
      ),
    ),
  );
  /**
   * 발행 거버넌스 판정 (TASK-2501) — 콘텐츠별 병렬 조회.
   *
   * 발행 버튼 옆에 판정을 함께 두는 이유: 눌러 보고 막히는 것과, 무엇이
   * 막는지 먼저 보는 것은 다르다. 조회는 전이하지 않으므로 안전하다.
   */
  const verdicts = new Map(
    await Promise.all(
      contents.map(
        async (content) =>
          [
            content.id,
            await fetchJson<ContentGovernanceDto>(
              `/projects/${id}/contents/${content.id}/governance`,
            ),
          ] as const,
      ),
    ),
  );

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

      <section
        data-testid="preflight-section"
        className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">발행 위반 스캔</h2>
          <span className="text-xs text-zinc-500">
            상태를 바꾸지 않습니다 (CTO 결정 2501-①)
          </span>
        </div>
        <GovernancePreflightPanel scan={preflight} />
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
            {contents.map((content) => {
              const history = histories.get(content.id) ?? [];
              return (
                <li
                  key={content.id}
                  data-testid="content-item"
                  className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                      <span className="font-medium">{content.title}</span>
                      <ContentStatusBadge status={content.status} />
                      <span className="text-xs text-zinc-400">
                        PO v{content.productObjectVersion ?? "-"} ·{" "}
                        {content.createdAt.slice(0, 16).replace("T", " ")}
                      </span>
                      {content.publishedAt ? (
                        <span
                          data-testid="content-published-at"
                          className="text-xs text-emerald-600 dark:text-emerald-400"
                        >
                          발행: {content.publishedAt.slice(0, 16).replace("T", " ")}{" "}
                          (UTC)
                        </span>
                      ) : null}
                    </summary>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-4 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                      {content.body}
                    </pre>
                  </details>
                  <ContentGovernancePanel
                    verdict={verdicts.get(content.id) ?? null}
                  />
                  <div className="mt-3">
                    <ContentStatusActions
                      projectId={project.id}
                      contentId={content.id}
                      status={content.status}
                    />
                  </div>
                  {history.length > 0 ? (
                    <div
                      data-testid="content-history"
                      className="mt-3 border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800"
                    >
                      <p className="mb-1 font-medium text-zinc-600 dark:text-zinc-400">
                        감사 이력
                      </p>
                      <ul className="flex flex-col gap-0.5">
                        {history.map((item) => (
                          <li key={item.id}>
                            {item.createdAt.slice(0, 19).replace("T", " ")} (UTC) —{" "}
                            {item.fromStatus} → {item.toStatus}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
