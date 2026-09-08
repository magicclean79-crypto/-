"use client";

import { useCallback, useState } from "react";
import type { ProductProfileDto, ProductProfileFinalPageDto } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { authFetchInit } from "../../lib/auth-client";
import { findProfileForSourceImage } from "./product-profile-lookup";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** `GET /product-profile/:id/final` — 여기서는 조회만 하고(추가 LLM 호출 없음), 준비 상태 확인에만 쓴다 */
async function fetchFinalPage(id: string): Promise<ProductProfileFinalPageDto> {
  const response = await fetch(
    `${API_URL}/product-profile/${id}/final`,
    authFetchInit({ method: "GET" }),
  );
  const body = (await response.json()) as ProductProfileFinalPageDto & {
    message?: string | string[];
  };
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new Error(message ?? `준비 상태 확인 실패 (HTTP ${response.status})`);
  }
  return body;
}

type PanelState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "no-profile" }
  | { phase: "no-selection"; profile: ProductProfileDto }
  | { phase: "ready"; profile: ProductProfileDto; page: ProductProfileFinalPageDto }
  | { phase: "error"; message: string };

/**
 * Image Studio ④-A — 참조 이미지 선택/검증 단계 (T1-131로 재정의).
 *
 * 이전에는 이 패널이 카테고리 순서 템플릿으로 조립한 **별도의 최종 HTML**을
 * 직접 보여줬다(iframe 미리보기 + 다운로드 링크). 최종 상세페이지 생성
 * 경로를 ④-B(Product Story, 캐노니컬 파이프라인) 하나로 합치면서, 이
 * 패널은 더 이상 최종 페이지를 만들지 않는다 — 대신 ③에서 선택한 실제
 * 제품 이미지가 최종 생성을 시작하기에 충분한지(카테고리별 선택 여부·
 * 검증 상태)만 확인한다. `GET /final`을 그대로 재사용하지만(추가 비용
 * 없음), 응답의 html/css는 표시하지 않는다.
 */
export function DetailPagePanel({ sourceImageId }: { sourceImageId: string }) {
  const [state, setState] = useState<PanelState>({ phase: "idle" });

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const profile = await findProfileForSourceImage(sourceImageId);
      if (!profile || profile.status !== "SUCCESS" || !profile.html) {
        setState({ phase: "no-profile" });
        return;
      }
      const page = await fetchFinalPage(profile.id);
      if (page.selectedImageCount === 0) {
        setState({ phase: "no-selection", profile });
        return;
      }
      setState({ phase: "ready", profile, page });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "준비 상태 확인 실패",
      });
    }
  }, [sourceImageId]);

  return (
    <Card title="④-A. 참조 이미지 선택 확인 (최종 생성 전 검증)">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-zinc-500">
          이 단계는 최종 상세페이지를 만들지 않습니다 — 위 ③ 단계에서 선택(✓ 선택됨)한 이미지가
          최종 생성(아래 ④-B)을 시작하기에 충분한지만 확인합니다. 제품 참조 사진(①)은 여기 입력으로
          쓰이지 않습니다. 추가 과금 없음(LLM을 부르지 않고 선택 상태만 조회).
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state.phase === "loading"}
          className="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {state.phase === "loading"
            ? "확인 중…"
            : state.phase === "ready"
              ? "다시 확인"
              : "선택 상태 확인"}
        </button>

        {state.phase === "no-profile" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            이 사진에 대해 검증된 Product Profile이 아직 없습니다 — 먼저{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">
              /product-profile
            </code>
            에서 사진 분석을 실행하세요.
          </p>
        )}

        {state.phase === "no-selection" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            선택된 이미지가 없어 최종 생성을 시작할 수 없습니다 — 위 ③ 단계(카테고리별 AI
            생성 후보)에서 최소 1장을 선택한 뒤 다시 확인하세요.
          </p>
        )}

        {state.phase === "error" && (
          <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>
        )}

        {state.phase === "ready" && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="ok">선택 이미지 {state.page.selectedImageCount}장 — 최종 생성 준비됨</Badge>
              <Badge tone={state.page.source === "story" ? "ok" : "warn"}>
                {state.page.source === "story"
                  ? "이미 생성된 최종 상세페이지 있음 (④-B 결과)"
                  : "아직 최종 상세페이지가 생성되지 않았습니다 — 아래 ④-B에서 생성하세요"}
              </Badge>
            </div>
            {state.page.validation && !state.page.validation.ok && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                자동 품질 검증에서 확인이 필요한 항목이 {state.page.validation.issues.length}건
                있습니다 — 아래 ④-B에서 최종 상세페이지를 생성/확인할 때 함께 살펴보세요.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
