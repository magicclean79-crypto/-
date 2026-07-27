import type { Metadata } from "next";
import Link from "next/link";
import type { ProjectListItemDto } from "@acos/shared";

export const metadata: Metadata = {
  title: "프로젝트 | AI Product Content OS",
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function fetchProjects(): Promise<ProjectListItemDto[] | null> {
  try {
    const response = await fetch(`${API_URL}/projects?take=50`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { projects: ProjectListItemDto[] };
    return body.projects;
  } catch {
    return null;
  }
}

export default async function ProjectsPage() {
  const projects = await fetchProjects();

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
          <h1 className="mt-2 text-3xl font-bold tracking-tight">프로젝트</h1>
          <p className="mt-1 text-sm text-zinc-500">
            사진 → OCR → Product Object → 상세페이지 파이프라인의 작업 단위
          </p>
        </div>
        <Link
          href="/upload"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          📸 사진 업로드
        </Link>
      </div>

      {projects === null && (
        <p className="text-zinc-500">
          프로젝트 목록을 불러올 수 없습니다. API 서버를 확인해 주세요.
        </p>
      )}
      {projects?.length === 0 && (
        <p className="text-zinc-500">
          아직 프로젝트가 없습니다. 사진을 업로드하면 자동으로 생성됩니다.
        </p>
      )}

      {projects && projects.length > 0 && (
        <ul className="flex flex-col gap-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div>
                  <h2 className="font-semibold">{project.name}</h2>
                  {project.description && (
                    <p className="mt-1 text-sm text-zinc-500">
                      {project.description}
                    </p>
                  )}
                </div>
                <div className="text-right text-sm text-zinc-500">
                  <p>상품 {project.productCount}개</p>
                  <p>Product Object {project.productObjectCount}개</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
