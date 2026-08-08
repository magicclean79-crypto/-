"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  GenerateImageCandidatesResult,
  ImageCategory,
  ImageDto,
} from "@acos/shared";
import { IMAGE_CATEGORY_LABELS } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { authFetchInit } from "../../lib/auth-client";
import { AuthImage } from "../product-profile/auth-image";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function generateCandidates(
  imageId: string,
  category: ImageCategory,
  style: string,
): Promise<GenerateImageCandidatesResult> {
  const response = await fetch(
    `${API_URL}/image-gen/candidates`,
    authFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId, category, style: style || undefined }),
    }),
  );
  const body = (await response.json()) as GenerateImageCandidatesResult & {
    message?: string | string[];
  };
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new Error(message ?? `생성 실패 (HTTP ${response.status})`);
  }
  return body;
}

async function fetchCandidates(sourceImageId: string, category: ImageCategory): Promise<ImageDto[]> {
  const response = await fetch(
    `${API_URL}/image-gen/candidates?sourceImageId=${sourceImageId}&category=${category}`,
    authFetchInit(),
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { results: ImageDto[] };
  return body.results;
}

async function selectImage(imageId: string): Promise<ImageDto> {
  const response = await fetch(
    `${API_URL}/image-gen/select`,
    authFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId }),
    }),
  );
  return response.json();
}

const STYLE_PRESETS = [
  "",
  "더 고급스럽게",
  "더 감성적으로",
  "더 프리미엄하게",
  "더 밝게",
  "더 실사용 느낌으로",
  "더 미니멀하게",
  "완전히 새롭게",
];

export function CategoryPanel({ category, sourceImageId }: { category: ImageCategory; sourceImageId: string }) {
  const [allVersions, setAllVersions] = useState<ImageDto[]>([]);
  const [versionIndex, setVersionIndex] = useState(0); // 0 = 최신
  const [style, setStyle] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const results = await fetchCandidates(sourceImageId, category);
    setAllVersions(results);
    setVersionIndex(0);
  }, [sourceImageId, category]);

  useEffect(() => {
    void load();
  }, [load]);

  const versionNumbers = [...new Set(allVersions.map((v) => v.groupVersion ?? 0))].sort((a, b) => b - a);
  const currentVersion = versionNumbers[versionIndex];
  const currentCandidates = allVersions.filter((v) => v.groupVersion === currentVersion);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await generateCandidates(sourceImageId, category, style);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성 실패");
    } finally {
      setRunning(false);
    }
  };

  const pick = async (imageId: string) => {
    await selectImage(imageId);
    await load();
  };

  return (
    <Card title={IMAGE_CATEGORY_LABELS[category]}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            {STYLE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {preset || "스타일 방향 선택 (선택)"}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {running ? "생성 중…" : currentCandidates.length > 0 ? "재생성 (새 버전)" : "생성"}
          </button>
          {versionNumbers.length > 1 && (
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <button
                type="button"
                disabled={versionIndex >= versionNumbers.length - 1}
                onClick={() => setVersionIndex((i) => i + 1)}
                className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-30 dark:border-zinc-700"
              >
                ← 이전 버전
              </button>
              <span>V{currentVersion}</span>
              <button
                type="button"
                disabled={versionIndex <= 0}
                onClick={() => setVersionIndex((i) => i - 1)}
                className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-30 dark:border-zinc-700"
              >
                다음 버전 →
              </button>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        {currentCandidates.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700">
            아직 생성되지 않음
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {currentCandidates.map((candidate, i) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => void pick(candidate.id)}
                className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1 ${
                  candidate.selected ? "border-emerald-600" : "border-transparent"
                }`}
              >
                <AuthImage
                  imageId={candidate.id}
                  alt={`${IMAGE_CATEGORY_LABELS[category]} ${String.fromCharCode(65 + i)}`}
                  className="h-32 w-full rounded object-cover"
                />
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium">{String.fromCharCode(65 + i)}</span>
                  {candidate.selected && <Badge tone="ok">선택됨</Badge>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
