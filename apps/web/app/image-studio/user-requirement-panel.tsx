"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProductProfileDto } from "@acos/shared";
import { USER_REQUIREMENT_MAX_LENGTH, validateUserRequirementText } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { imageStudioFetch } from "./api-client";
import { findProfileForSourceImage } from "./product-profile-lookup";

/** 사용자 요구사항만 저장한다 — 비용 없음(LLM 재호출 없이 DB 값만 갱신) */
async function saveUserRequirement(
  profileId: string,
  userRequirement: string,
): Promise<ProductProfileDto> {
  return imageStudioFetch<ProductProfileDto>(`/product-profile/${profileId}/user-requirement`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userRequirement: userRequirement.trim() || null }),
  });
}

/**
 * 요구사항을 반영해 상세페이지(STEP 3+4+5)를 다시 생성한다 — 실 OpenAI
 * 호출 3건, 실제 과금 발생. 같은 원본 사진들로 새 Product Profile 실행을
 * 만든다(기존 실행은 지우지 않고 그대로 남는다 — 이전 버전 유지 원칙,
 * `docs/PROJECT_MEMORY.md` M-18과 같은 원칙).
 */
async function regenerateWithRequirement(
  imageIds: string[],
  projectId: string | null,
  templateKey: string | null,
  userRequirement: string,
): Promise<ProductProfileDto> {
  return imageStudioFetch<ProductProfileDto>("/product-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageIds,
      projectId: projectId ?? undefined,
      templateKey: templateKey ?? undefined,
      userRequirement: userRequirement.trim() || undefined,
    }),
  });
}

type PanelState =
  | { phase: "loading" }
  | { phase: "no-profile" }
  | { phase: "ready"; profile: ProductProfileDto }
  | { phase: "error"; message: string };

/**
 * 사용자 요구사항 기반 생성 (T1-92) — Image Studio "빠른 테스트"에서 쓰던
 * 자유 텍스트 요구사항 개념을 정식 파이프라인에 통합한다. 여기 저장한
 * 요구사항 하나가 아래 두 곳에 그대로 쓰인다.
 *
 * - AI 이미지 생성(카테고리별 후보·대표 썸네일 등): 저장만 하면(비용
 *   없음) 바로 다음 생성부터 반영된다 — 각 생성 호출이 이 Product Profile을
 *   다시 조회해 Product Package에 실어 보낸다(`image-gen.service.ts`).
 * - 상세페이지 카피(STEP 5a): "재생성" 버튼을 눌러야 반영된다(실
 *   OpenAI 호출 3건 발생) — 카피는 실행 시점에만 생성되기 때문이다.
 *
 * 실제 제품 정보(Product Profile/Package)와 충돌하는 요구사항은 프롬프트
 * 규칙으로 무시하도록 지시하지만, 최종 판단은 브라우저에서 사람이 한다
 * (`docs/MASTER_GUIDE.md` §2 철학 3).
 */
export function UserRequirementPanel({ sourceImageId }: { sourceImageId: string }) {
  const [state, setState] = useState<PanelState>({ phase: "loading" });
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    setSaveError(null);
    setRegenerateError(null);
    setSavedNotice(false);
    try {
      const profile = await findProfileForSourceImage(sourceImageId);
      if (!profile) {
        setState({ phase: "no-profile" });
        return;
      }
      setState({ phase: "ready", profile });
      setText(profile.userRequirement ?? "");
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "제품 정보 조회 실패",
      });
    }
  }, [sourceImageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (state.phase !== "ready") return;
    const validation = validateUserRequirementText(text);
    if (!validation.ok) {
      setSaveError(validation.reason ?? "요구사항을 확인해 주세요");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSavedNotice(false);
    try {
      const updated = await saveUserRequirement(state.profile.id, text);
      setState({ phase: "ready", profile: updated });
      setSavedNotice(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "요구사항 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    if (state.phase !== "ready") return;
    const validation = validateUserRequirementText(text);
    if (!validation.ok) {
      setRegenerateError(validation.reason ?? "요구사항을 확인해 주세요");
      return;
    }
    setRegenerating(true);
    setRegenerateError(null);
    setSavedNotice(false);
    try {
      const updated = await regenerateWithRequirement(
        state.profile.imageIds,
        state.profile.projectId,
        state.profile.templateKey,
        text,
      );
      setState({ phase: "ready", profile: updated });
    } catch (err) {
      setRegenerateError(err instanceof Error ? err.message : "상세페이지 재생성 실패");
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <Card title="공용 요구사항 입력 (선택 — 상세페이지 문구 + 목적별 요구사항이 없는 카테고리에 반영됩니다)">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-zinc-500">
          어떤 느낌으로 만들지 자유롭게 적으세요(예: &quot;더 고급스러운 느낌으로&quot;,
          &quot;주방 배경으로&quot;). 저장하면 아래 카테고리 카드에 목적별 요구사항을
          따로 입력하지 않은 경우에 한해 AI 이미지 생성부터 바로 반영됩니다
          (추가 과금 없음) — 대표 썸네일·디테일샷·사용 이미지·구성품처럼 목적마다
          다른 요구사항이 필요하면 각 카테고리 카드 안의 &quot;이 목적만의
          요구사항&quot;을 따로 입력하세요(그쪽이 있으면 그쪽이 우선합니다).
          상세페이지 문구까지 바꾸려면 아래 &quot;요구사항 반영해서 상세페이지
          재생성&quot;을 눌러야 합니다(실 OpenAI 호출 3건, 실제 과금 발생).
          실제 제품의 형태·구조·구성품·색상·재질과 충돌하는 요구는 반영되지
          않습니다 — 제품 사실이 항상 우선합니다.
        </p>

        {state.phase === "loading" && (
          <p className="text-xs text-zinc-400">제품 정보 확인 중…</p>
        )}

        {state.phase === "no-profile" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            이 사진에 대해 검증된 Product Profile이 아직 없습니다 — 먼저{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">
              /product-profile
            </code>
            에서 사진 분석을 실행하세요. 그전에는 요구사항을 저장할 곳이 없습니다.
          </p>
        )}

        {state.phase === "error" && (
          <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>
        )}

        {state.phase === "ready" && (
          <div className="flex flex-col gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="예: 더 고급스러운 느낌으로, 주방 배경으로 만들어줘"
              rows={2}
              maxLength={USER_REQUIREMENT_MAX_LENGTH}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <p className="text-right text-[11px] text-zinc-400">
              {text.trim().length}/{USER_REQUIREMENT_MAX_LENGTH}자
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {saving ? "저장 중…" : "요구사항 저장"}
              </button>
              <button
                type="button"
                onClick={() => void regenerate()}
                disabled={regenerating}
                className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {regenerating
                  ? "재생성 중… (실 OpenAI 호출 3건, 수 초 소요)"
                  : "요구사항 반영해서 상세페이지 재생성"}
              </button>
              {savedNotice && <Badge tone="ok">저장됨</Badge>}
            </div>
            {saveError && <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>}
            {regenerateError && (
              <p className="text-xs text-red-600 dark:text-red-400">{regenerateError}</p>
            )}
            {state.profile.pageCopy && (
              <p className="text-xs text-zinc-500">
                현재 상세페이지 대표 문구: &ldquo;{state.profile.pageCopy.headline}&rdquo;
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
