"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { DesignReviewDto, ImageDto } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { authFetchInit, getAuthToken } from "../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const PROVIDER_OPTIONS = [
  { value: "", label: "자동 (라우팅 설정을 따름)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Claude (Anthropic)" },
  { value: "gemini", label: "Gemini" },
];

interface UploadItem {
  id: string;
  previewUrl: string;
  image?: ImageDto;
  status: "uploading" | "done" | "error";
  error?: string;
}

function uploadImage(file: File): Promise<ImageDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("files", file);
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as {
          images?: ImageDto[];
          message?: string | string[];
        };
        if (xhr.status >= 200 && xhr.status < 300 && body.images?.[0]) {
          resolve(body.images[0]);
        } else {
          const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
          reject(new Error(message ?? `업로드 실패 (HTTP ${xhr.status})`));
        }
      } catch {
        reject(new Error(`업로드 실패 (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("API 서버에 연결할 수 없습니다."));
    xhr.open("POST", `${API_URL}/uploads/images`);
    xhr.withCredentials = true;
    const token = getAuthToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.send(formData);
  });
}

async function runDesignReview(
  imageIds: string[],
  category: string,
  notes: string,
  provider: string,
): Promise<DesignReviewDto> {
  const response = await fetch(
    `${API_URL}/design-review`,
    authFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageIds,
        category,
        notes: notes || undefined,
        provider: provider || undefined,
      }),
    }),
  );
  const body = (await response.json()) as DesignReviewDto & { message?: string | string[] };
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new Error(message ?? `디자인 리뷰 실행 실패 (HTTP ${response.status})`);
  }
  return body;
}

function ResultCard({ result }: { result: DesignReviewDto }) {
  if (result.status === "FAILED" || !result.result) {
    return (
      <Card title="디자인 리뷰 결과">
        <p className="text-sm text-red-600 dark:text-red-400">{result.error ?? "알 수 없는 오류"}</p>
      </Card>
    );
  }
  const r = result.result;
  const rows: [string, string][] = [
    ["레이아웃", r.layout],
    ["타이포그래피", r.typography],
    ["여백", r.whitespace],
    ["사진 배치", r.imagePlacement],
    ["색상 사용", r.colorUsage],
    ["시선 흐름", r.visualHierarchy],
    ["구매 유도력", r.purchaseMotivation],
    ["모바일 UX", r.mobileUx],
  ];
  return (
    <Card title="디자인 리뷰 결과">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ok">provider: {result.provider ?? "-"}</Badge>
          <Badge tone="ok">종합 점수 {r.overallScore}/100</Badge>
        </div>
        <p className="text-sm">{r.summary}</p>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium text-zinc-500">{label}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="text-xs font-medium text-zinc-500">강점</p>
          <ul className="list-inside list-disc text-sm">
            {r.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-500">개선점</p>
          <ul className="list-inside list-disc text-sm">
            {r.improvements.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

export function DesignReviewFlow() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [provider, setProvider] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DesignReviewDto | null>(null);

  const onFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      const previewUrl = URL.createObjectURL(file);
      setItems((prev) => [...prev, { id, previewUrl, status: "uploading" }]);
      uploadImage(file)
        .then((image) => {
          setItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, image, status: "done" } : item)),
          );
        })
        .catch((err) => {
          setItems((prev) =>
            prev.map((item) =>
              item.id === id
                ? { ...item, status: "error", error: err instanceof Error ? err.message : "업로드 실패" }
                : item,
            ),
          );
        });
    });
  }, []);

  const imageIds = items.filter((item) => item.image).map((item) => item.image!.id);

  const submit = useCallback(async () => {
    setError(null);
    setResult(null);
    if (imageIds.length === 0) {
      setError("스크린샷을 최소 1장 업로드해야 합니다.");
      return;
    }
    if (!category.trim()) {
      setError("카테고리를 입력해야 합니다 (예: 캠핑용품).");
      return;
    }
    setRunning(true);
    try {
      const dto = await runDesignReview(imageIds, category.trim(), notes, provider);
      setResult(dto);
    } catch (err) {
      setError(err instanceof Error ? err.message : "실행 실패");
    } finally {
      setRunning(false);
    }
  }, [imageIds, category, notes, provider]);

  return (
    <div className="flex flex-col gap-6">
      <Card title="1. 평가할 스크린샷">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(e) => onFiles(e.target.files)}
          className="text-sm"
        />
        {items.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3">
            {items.map((item) => (
              <div key={item.id} className="flex flex-col items-center gap-1">
                <img
                  src={item.previewUrl}
                  alt="업로드 미리보기"
                  className="h-20 w-20 rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
                />
                {item.status === "uploading" && (
                  <span className="text-xs text-zinc-500">업로드 중…</span>
                )}
                {item.status === "error" && (
                  <span className="text-xs text-red-600 dark:text-red-400">{item.error}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="2. 평가 조건">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            카테고리
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="예: 캠핑용품, 생활용품"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            참고 맥락 (선택)
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="예: Template V1 시안입니다"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Provider (비교 테스트용 강제 지정)
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={running}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? "리뷰 실행 중… (실 LLM 호출, 수 초~수십 초 소요)" : "디자인 리뷰 실행"}
        </button>
        <Link
          href="/design-review/history"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          이력 보기
        </Link>
        <Link
          href="/executions?feature=design-review"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          비용·응답시간·오류 로그 보기
        </Link>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {result && (
        <>
          <ResultCard result={result} />
          <div className="flex gap-3">
            <Link
              href={`/design-review/history/${result.id}`}
              className="text-xs text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
            >
              이 결과의 상세 화면 열기 →
            </Link>
            <Link
              href="/executions?feature=design-review"
              className="text-xs text-blue-600 underline hover:text-blue-800 dark:text-blue-400"
            >
              이 호출의 비용·응답시간 확인 →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
