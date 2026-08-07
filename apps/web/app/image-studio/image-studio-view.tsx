"use client";

import { useState } from "react";
import type { GenerateHeroImageResult, ImageDto } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { authFetchInit } from "../../lib/auth-client";
import { AuthImage } from "../product-profile/auth-image";
import { BENCHMARK_IMAGE_IDS } from "../benchmark/constants";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function generateHero(imageId: string, backgroundPrompt: string): Promise<GenerateHeroImageResult> {
  const response = await fetch(
    `${API_URL}/image-gen/hero`,
    authFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId, backgroundPrompt: backgroundPrompt || undefined }),
    }),
  );
  const body = (await response.json()) as GenerateHeroImageResult & { message?: string | string[] };
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new Error(message ?? `이미지 생성 실패 (HTTP ${response.status})`);
  }
  return body;
}

function StepCard({ label, image, description }: { label: string; image: ImageDto; description: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge tone="ok">{label}</Badge>
        <span className="text-xs text-zinc-500">{description}</span>
      </div>
      <AuthImage
        imageId={image.id}
        alt={label}
        className="h-64 w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
      />
    </div>
  );
}

export function ImageStudioView() {
  const [selectedId, setSelectedId] = useState(BENCHMARK_IMAGE_IDS[0]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateHeroImageResult | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await generateHero(selectedId, prompt);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "실행 실패");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card title="1. 원본 제품 사진 선택 (Benchmark 분사기 7장)">
        <div className="flex flex-wrap gap-3">
          {BENCHMARK_IMAGE_IDS.map((imageId) => (
            <button
              key={imageId}
              type="button"
              onClick={() => setSelectedId(imageId)}
              className={`rounded-lg border-2 p-1 ${
                selectedId === imageId ? "border-blue-600" : "border-transparent"
              }`}
            >
              <AuthImage imageId={imageId} alt="원본 후보" className="h-20 w-20 rounded object-cover" />
            </button>
          ))}
        </div>
      </Card>

      <Card title="2. 원하는 배경 (선택 — 비워두면 자동으로 자연스러운 생활 공간을 만듭니다)">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="예: 밝은 베란다, 타일 바닥, 화분이 보이는 공간"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </Card>

      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        className="self-start rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
      >
        {running
          ? "실행 중… (배경 제거 → 배경 생성 → 합성, 실 Gemini 호출 3건, 수십 초 소요)"
          : "배경 제거 → 배경 생성 → 합성 실행"}
      </button>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {result && (
        <Card title="결과 — 4단계 그대로 보기">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StepCard label="원본" image={result.original} description="사람이 찍은 원본 사진" />
            <StepCard
              label="배경 제거"
              image={result.backgroundRemoved}
              description="Gemini가 배경을 지운 결과"
            />
            <StepCard
              label="배경 생성"
              image={result.backgroundGenerated}
              description="Gemini가 새로 만든 배경"
            />
            <StepCard
              label="최종 합성"
              image={result.composited}
              description="제품을 새 배경에 합성한 최종 결과"
            />
          </div>
        </Card>
      )}
    </div>
  );
}
