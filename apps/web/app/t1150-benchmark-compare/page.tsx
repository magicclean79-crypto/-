import Link from "next/link";
import report from "../../public/t1150-benchmark-compare/report.json";

const CATEGORY_LABEL: Record<string, string> = {
  HERO: "대표썸네일 (HERO)",
  USAGE_SCENE: "사용 장면 (USAGE_SCENE)",
  DETAIL: "상세 (DETAIL)",
};

const PROVIDER_LABEL: Record<string, string> = {
  gemini: "Gemini",
  openai: "GPT Image 2 (OpenAI)",
};

interface CompareResult {
  category: string;
  provider: string;
  model: string;
  ok: boolean;
  elapsedMs: number;
  file: string;
}

const results = report.results as CompareResult[];
const categories = Array.from(new Set(results.map((r) => r.category)));

function resultFor(category: string, provider: string): CompareResult | undefined {
  return results.find((r) => r.category === category && r.provider === provider);
}

function ResultCard({ result }: { result?: CompareResult }) {
  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-400 dark:border-zinc-700">
        데이터 없음
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-64 w-full items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800">
        <img
          src={`/t1150-benchmark-compare/${result.file}`}
          alt={`${result.category} - ${PROVIDER_LABEL[result.provider] ?? result.provider}`}
          className="h-full w-full object-contain"
        />
      </div>
      <p className="text-sm font-semibold">{PROVIDER_LABEL[result.provider] ?? result.provider}</p>
      <p className="text-xs text-zinc-500">
        model: {result.model} · 응답시간: {(result.elapsedMs / 1000).toFixed(1)}초
      </p>
    </div>
  );
}

export default function T1150BenchmarkComparePage() {
  const pkg = report.pkg as { productName: string; brand: string | null; model: string | null };

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/image-studio"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← Image Studio
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Gemini vs GPT Image 2 — Benchmark 비교 (T1-150)
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Benchmark 제품: {pkg.productName}
          {pkg.brand ? ` · ${pkg.brand}` : ""}
        </p>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="font-semibold">T1-150에 기록된 비교 근거 (사실)</p>
        <ul className="mt-2 list-disc pl-5 text-zinc-600 dark:text-zinc-400">
          <li>HERO: Gemini는 &ldquo;글자 금지&rdquo; 규칙을 어기고 영문 텍스트를 이미지에 그렸음. GPT Image 2는 텍스트 없음.</li>
          <li>DETAIL: GPT Image 2가 레이아웃 계약(70% 채움·순백 배경)을 더 정확히 따랐음.</li>
          <li>응답시간: GPT Image 2가 Gemini보다 6~10배 느림.</li>
        </ul>
        <p className="mt-2 text-xs text-zinc-500">
          위 항목은 T1-150 실행 시 기록된 사실이며, 최종 품질 판단은 사람이 합니다.
        </p>
      </section>

      {categories.map((category) => (
        <section key={category} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{CATEGORY_LABEL[category] ?? category}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ResultCard result={resultFor(category, "gemini")} />
            <ResultCard result={resultFor(category, "openai")} />
          </div>
        </section>
      ))}

      <p className="text-xs text-zinc-500">
        원본 비교 데이터:{" "}
        <a
          href="/t1150-benchmark-compare/report.json"
          className="underline hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          report.json
        </a>
      </p>
    </main>
  );
}
