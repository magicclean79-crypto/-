"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ProductProfileDto } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { authFetchInit } from "../../../../lib/auth-client";
import { AuthImage } from "../../auth-image";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function versionKey(imageIds: string[]): string {
  return [...imageIds].sort().join(",");
}

async function fetchRun(id: string): Promise<ProductProfileDto> {
  const response = await fetch(`${API_URL}/product-profile/${id}`, authFetchInit());
  if (!response.ok) {
    throw new Error(`불러올 수 없습니다 (HTTP ${response.status})`);
  }
  return response.json();
}

async function fetchSiblingVersions(imageIds: string[]): Promise<ProductProfileDto[]> {
  const response = await fetch(`${API_URL}/product-profile?take=100`, authFetchInit());
  if (!response.ok) return [];
  const body = (await response.json()) as { results: ProductProfileDto[] };
  const key = versionKey(imageIds);
  return body.results
    .filter((item) => versionKey(item.imageIds) === key)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function downloadHtml(id: string, productName: string): Promise<void> {
  const response = await fetch(`${API_URL}/product-profile/${id}/html`, authFetchInit());
  if (!response.ok) {
    throw new Error(`다운로드 실패 (HTTP ${response.status})`);
  }
  const html = await response.text();
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${productName.replace(/[\\/:*?"<>|]/g, "_") || "product-page"}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function HistoryDetail({ id }: { id: string }) {
  const router = useRouter();
  const [record, setRecord] = useState<ProductProfileDto | null>(null);
  const [versions, setVersions] = useState<ProductProfileDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchRun(id)
      .then((r) => {
        setRecord(r);
        return fetchSiblingVersions(r.imageIds);
      })
      .then(setVersions)
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const regenerate = useCallback(async () => {
    if (!record) return;
    setRegenerating(true);
    setRegenerateError(null);
    try {
      const response = await fetch(
        `${API_URL}/product-profile`,
        authFetchInit({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageIds: record.imageIds,
            projectId: record.projectId ?? undefined,
          }),
        }),
      );
      const body = (await response.json()) as ProductProfileDto & { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? `재생성 실패 (HTTP ${response.status})`);
      }
      router.push(`/product-profile/history/${body.id}`);
    } catch (err) {
      setRegenerateError(err instanceof Error ? err.message : "재생성에 실패했습니다.");
    } finally {
      setRegenerating(false);
    }
  }, [record, router]);

  if (error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (!record) {
    return <p className="text-sm text-zinc-500">불러오는 중…</p>;
  }

  const myVersionIndex = versions.findIndex((v) => v.id === record.id);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">
          {record.profile?.productName ?? "(상품명 없음)"}
        </h1>
        {record.status === "SUCCESS" && <Badge tone="ok">성공</Badge>}
        {record.status === "FAILED" && <Badge tone="warn">실패</Badge>}
        {versions.length > 1 && (
          <Badge tone="ok">
            버전 {myVersionIndex + 1} / {versions.length}
          </Badge>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        생성 {record.createdAt.replace("T", " ").slice(0, 19)} · id {record.id} · provider{" "}
        {record.provider ?? "-"}
      </p>

      {record.status === "FAILED" && (
        <p className="text-sm text-red-600 dark:text-red-400">{record.error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void regenerate()}
          disabled={regenerating}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {regenerating ? "다시 생성 중… (수 초 소요)" : "같은 사진으로 다시 생성"}
        </button>
        {record.status === "SUCCESS" && record.html && (
          <button
            type="button"
            onClick={() =>
              void downloadHtml(record.id, record.profile?.productName ?? "product-page")
            }
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            HTML 파일로 다운로드
          </button>
        )}
      </div>
      {regenerateError && (
        <p className="text-sm text-red-600 dark:text-red-400">{regenerateError}</p>
      )}

      {/* 버전 목록 */}
      {versions.length > 1 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">버전 목록 (같은 사진, {versions.length}회 생성)</h2>
          <ul className="flex flex-wrap gap-2">
            {versions.map((v, index) => (
              <li key={v.id}>
                <Link
                  href={`/product-profile/history/${v.id}`}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    v.id === record.id
                      ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                      : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  }`}
                >
                  버전 {index + 1} · {v.createdAt.slice(5, 16).replace("T", " ")}
                </Link>
              </li>
            ))}
          </ul>
          {versions.length >= 2 && (
            <Link
              href={`/product-profile/history/compare?a=${versions[versions.length - 2].id}&b=${versions[versions.length - 1].id}`}
              className="text-xs text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
            >
              최근 두 버전 비교 →
            </Link>
          )}
        </section>
      )}

      {/* 사용된 사진 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">사용된 사진 ({record.imageIds.length}장)</h2>
        <div className="flex flex-wrap gap-3">
          {record.imageIds.map((imageId) => (
            <AuthImage
              key={imageId}
              imageId={imageId}
              alt="사용된 사진"
              className="h-28 w-28 rounded-lg object-cover"
            />
          ))}
        </div>
      </section>

      {/* HTML 미리보기 */}
      {record.status === "SUCCESS" && record.html && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">HTML 미리보기</h2>
          <iframe
            title="상세페이지 미리보기"
            srcDoc={`<style>${record.css ?? ""}</style>${record.html}`}
            sandbox=""
            className="h-[640px] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
          />
        </section>
      )}

      {/* OCR 결과 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">OCR 결과</h2>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
          {record.ocrText || "(추출된 텍스트 없음)"}
        </pre>
      </section>

      {/* Vision 분석 결과 */}
      {record.imageFeatures && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Vision 분석 결과 (STEP 3)</h2>
          <Card title="이미지 특징 분석">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-zinc-500">재질</dt>
                <dd>{record.imageFeatures.material ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">색상</dt>
                <dd>{record.imageFeatures.color ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">구조</dt>
                <dd>{record.imageFeatures.structure ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zinc-500">용도</dt>
                <dd>{record.imageFeatures.usage ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-zinc-500">구성품</dt>
                <dd>{record.imageFeatures.components.join(", ") || "—"}</dd>
              </div>
            </dl>
          </Card>
        </section>
      )}

      {/* Product Profile JSON */}
      {record.profile && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">제품 정보 (STEP 4)</h2>
          <details className="rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              JSON 원본 보기
            </summary>
            <pre className="max-h-[480px] overflow-auto px-4 pb-4 text-xs">
              {JSON.stringify({ profile: record.profile, pageCopy: record.pageCopy }, null, 2)}
            </pre>
          </details>
        </section>
      )}
    </div>
  );
}
