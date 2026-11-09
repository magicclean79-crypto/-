"use client";

import { useState } from "react";
import type { ProductProfileDto, ProductStoryResultDto } from "@acos/shared";
import { USER_REQUIREMENT_MAX_LENGTH, validateUserRequirementText } from "@acos/shared";
import { Badge, Card } from "@acos/ui";
import { findProfileForSourceImage } from "./product-profile-lookup";
import { IMAGE_STUDIO_API_URL, imageStudioFetch } from "./api-client";

const API_URL = IMAGE_STUDIO_API_URL;

/**
 * `POST /product-profile/:id/story` — 실 LLM 호출 1건, 과금 발생. 무상태(저장 안 함).
 * `imageStudioFetch`(T1-119 공통 래퍼)를 쓴다 — 이전에는 직접 `fetch`를 호출해
 * 네트워크 오류가 브라우저 원문 "Failed to fetch" 그대로 화면에 노출됐다(T1-152).
 */
async function generateStory(
  profileId: string,
  userRequirement: string,
): Promise<ProductStoryResultDto> {
  return imageStudioFetch<ProductStoryResultDto>(`/product-profile/${profileId}/story`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userRequirement: userRequirement.trim() || null }),
  });
}

type PanelState =
  | { phase: "idle" }
  | { phase: "loading-profile" }
  | { phase: "no-profile" }
  | { phase: "ready-to-generate"; profile: ProductProfileDto }
  | { phase: "generating"; profile: ProductProfileDto }
  | { phase: "generated"; profile: ProductProfileDto; result: ProductStoryResultDto }
  | { phase: "error"; message: string; profile?: ProductProfileDto };

/**
 * Product Story 기반 최종 상세페이지 (T1-94, T1-131부터 캐노니컬 파이프라인).
 * "이 제품의 스토리는 무엇인가"를 먼저 LLM으로 설계하고, 그 스토리의 각
 * 섹션에 실제 제품 사진(③에서 선택)과 필요한 곳엔 AI 생성 비주얼을
 * 연결해 하나의 완성된 상세페이지로 조립한다. ④-A(참조 이미지 선택 확인)는
 * 이 단계를 시작하기 전 준비 상태만 확인하고, 실제 최종 상세페이지는
 * 이 패널이 만드는 것 하나뿐이다 — 카테고리 순서로 조립하는 레거시 템플릿은
 * 이 파이프라인이 아직 한 번도 실행되지 않은 실행에서만 fallback으로 남는다.
 *
 * 실 LLM 호출 1건이 발생한다 — 다시 만들고 싶으면 다시 눌러야 하고, 그때마다
 * 다시 과금된다는 사실을 화면에 그대로 밝힌다. 생성에 성공하면 그 결과가
 * "지금의 최종 상세페이지"로 저장되어 `/final`·`/final-html`이 그대로
 * 서빙한다(재호출 없이).
 */
export function ProductStoryPanel({ sourceImageId }: { sourceImageId: string }) {
  const [state, setState] = useState<PanelState>({ phase: "idle" });
  const [requirement, setRequirement] = useState("");
  const [requirementError, setRequirementError] = useState<string | null>(null);

  const findProfile = async () => {
    setState({ phase: "loading-profile" });
    try {
      const profile = await findProfileForSourceImage(sourceImageId);
      if (!profile || profile.status !== "SUCCESS" || !profile.profile) {
        setState({ phase: "no-profile" });
        return;
      }
      setRequirement(profile.userRequirement ?? "");
      setState({ phase: "ready-to-generate", profile });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : "제품 정보 조회 실패" });
    }
  };

  const run = async (profile: ProductProfileDto) => {
    const validation = validateUserRequirementText(requirement);
    if (!validation.ok) {
      setRequirementError(validation.reason ?? "요구사항을 확인해 주세요");
      return;
    }
    setRequirementError(null);
    setState({ phase: "generating", profile });
    try {
      const result = await generateStory(profile.id, requirement);
      setState({ phase: "generated", profile, result });
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Product Story 생성 실패",
        profile,
      });
    }
  };

  const currentProfile =
    state.phase === "ready-to-generate" || state.phase === "generating" || state.phase === "generated"
      ? state.profile
      : state.phase === "error"
        ? state.profile
        : undefined;

  return (
    <Card title="④-B. 최종 상세페이지 생성 (Product Story 파이프라인)">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-zinc-500">
          이 제품의 스토리(왜 필요한가 → 어떤 상황에서 쓰는가 → 어떤 특징이 그 상황에
          대응하는가 → 실제 어떻게 생겼는가 → 구매 전 확인할 것)를 먼저 설계하고, 각 섹션에
          위 ③ 단계에서 선택(✓)한 실제 제품 이미지를 연결합니다. 제품 참조 사진(①)이 아니라
          ③에서 선택한 이미지가 연결됩니다 — 미리 선택해 두어야 합니다. 실제 제품 사진이 없는
          섹션에는 필요할 때만(최대 2개) AI가 추상 배경/강조 그래픽을 추가로 생성합니다 —
          제품을 대신 그리지 않고, 실제 제품 사진이 있으면 만들지 않습니다. <strong>실 LLM 호출
          1건 + 보조 그래픽 호출(있으면), 실제 과금이 발생</strong>합니다. 성공하면 이 결과가
          최종 상세페이지로 저장됩니다 — 다시 생성하면 그 결과로 덮어쓰고, 그때마다 다시
          과금됩니다.
        </p>

        {state.phase === "idle" && (
          <button
            type="button"
            onClick={() => void findProfile()}
            className="self-start rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Product Story 준비 확인
          </button>
        )}

        {state.phase === "loading-profile" && (
          <p className="text-xs text-zinc-400">제품 정보 확인 중…</p>
        )}

        {state.phase === "no-profile" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            이 사진에 대해 검증된 Product Profile이 아직 없습니다 — 먼저{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">/product-profile</code>
            에서 사진 분석을 실행하세요.
          </p>
        )}

        {currentProfile && (
          <div className="flex flex-col gap-2">
            <textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="이번 Story 생성에만 반영할 요구사항(선택) — 비워두면 저장된 요구사항을 그대로 씁니다"
              rows={2}
              maxLength={USER_REQUIREMENT_MAX_LENGTH}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            {requirementError && (
              <p className="text-xs text-red-600 dark:text-red-400">{requirementError}</p>
            )}
            <button
              type="button"
              onClick={() => void run(currentProfile)}
              disabled={state.phase === "generating"}
              className="self-start rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {state.phase === "generating"
                ? "생성 중… (실 LLM 호출 1건, 수 초~수십 초 소요)"
                : state.phase === "generated"
                  ? "다시 생성 (다시 과금됨)"
                  : "Product Story 생성"}
            </button>
          </div>
        )}

        {state.phase === "error" && (
          <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>
        )}

        {state.phase === "generated" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={state.result.quality.grade === "fail" ? "warn" : "ok"}>
                품질 점수 {state.result.quality.score}/100 (
                {state.result.quality.grade === "pass"
                  ? "목표 달성"
                  : state.result.quality.grade === "warn"
                    ? "통과 — 개선 여지 있음"
                    : "미달 — 성공으로 보지 말 것"}
                )
              </Badge>
              <Badge tone={state.result.validation.ok ? "ok" : "warn"}>
                섹션 {state.result.story.sections.length}개 —{" "}
                {state.result.validation.ok ? "자동 품질 검사 통과" : "확인 필요 항목 발견"}
              </Badge>
              <Badge tone="ok">
                {state.result.provider}/{state.result.model}
              </Badge>
              {state.result.attempts > 1 && (
                <Badge tone="warn">낮은 점수로 {state.result.attempts}회 시도(재생성 1회 포함)</Badge>
              )}
              {state.result.auxiliaryVisuals.length > 0 && (
                <Badge tone={state.result.auxiliaryVisuals.every((v) => v.generated) ? "ok" : "warn"}>
                  보조 그래픽 {state.result.auxiliaryVisuals.filter((v) => v.generated).length}/
                  {state.result.auxiliaryVisuals.length}개 생성(AI, 추가 과금)
                </Badge>
              )}
              {state.result.generativeVisuals.length > 0 && (
                <Badge tone={state.result.generativeVisuals.every((v) => v.generated) ? "ok" : "warn"}>
                  생성형 아이콘/타이포 모티프 {state.result.generativeVisuals.filter((v) => v.generated).length}/
                  {state.result.generativeVisuals.length}개 생성(AI, 추가 과금)
                </Badge>
              )}
            </div>

            {state.result.quality.grade === "fail" && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                <p className="font-semibold">
                  자동 재생성(1회) 후에도 품질 점수가 70점 미만입니다 — 이 결과를 성공으로
                  표시하지 않습니다. 아래 감점 사유를 먼저 확인하세요. 최종 판단은 사람이 합니다.
                </p>
                <ul className="mt-1 list-disc pl-4">
                  {state.result.quality.reasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {!state.result.validation.ok && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-semibold">
                  자동 품질 검증을 통과하지 못했습니다 — 아래 결과를 성공으로 보지
                  말고, 재생성하거나 무엇이 왜 걸렸는지 먼저 확인하세요. 최종
                  판단은 사람이 합니다.
                </p>
                <ul className="mt-1 list-disc pl-4">
                  {state.result.validation.issues.map((issue, index) => (
                    <li key={index}>
                      [{issue.severity}] {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <details className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
              <summary className="cursor-pointer font-semibold text-zinc-700 dark:text-zinc-300">
                Story 구조 보기 ({state.result.story.sections.length}개 섹션)
              </summary>
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">{state.result.story.narrativeSummary}</p>
              <ol className="mt-2 flex flex-col gap-2">
                {state.result.story.sections.map((section) => (
                  <li key={section.sectionId} className="rounded border border-zinc-100 p-2 dark:border-zinc-800">
                    <p className="font-medium">
                      {section.sectionId} — {section.purpose}
                    </p>
                    <p className="text-zinc-500">고객 상황: {section.customerContext}</p>
                    <p className="text-zinc-500">
                      이미지: {section.imageRole === "NONE" ? "없음" : `${section.imageRole}${section.assignedImageId ? ` (${section.assignedImageId})` : " — 배정된 이미지 없음"}`}
                    </p>
                    <p className="mt-1">{section.copy}</p>
                  </li>
                ))}
              </ol>
            </details>

            <details className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
              <summary className="cursor-pointer font-semibold text-zinc-700 dark:text-zinc-300">
                Design Plan 보기 — 카피(LLM)와 분리된 디자인 결정 (섹션마다 다른 레이아웃·아이콘·강조색)
              </summary>
              <p className="mt-2 text-zinc-500">
                아래 레이아웃·아이콘·강조색은 LLM이 아니라 이 섹션의 이미 검증된 필드(목적·이미지
                유무·근거 개수)에서 결정적 함수가 도출합니다 — 같은 Story면 항상 같은 Design Plan이
                나옵니다(새 AI 호출 없음, 비용 없음).
              </p>
              <p className="mt-1 text-zinc-500">
                글꼴: 제목 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{state.result.designPlan.typography.display}</code>
              </p>
              <ol className="mt-2 flex flex-col gap-1">
                {state.result.designPlan.sections.map((design) => (
                  <li key={design.sectionId} className="flex items-center gap-2 rounded border border-zinc-100 p-1.5 dark:border-zinc-800">
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: design.accentColor }}
                      aria-hidden="true"
                    />
                    <span className="font-medium">{design.sectionId}</span>
                    <span className="text-zinc-500">레이아웃: {design.layout}</span>
                    <span className="text-zinc-500">아이콘: {design.icon}</span>
                  </li>
                ))}
              </ol>
            </details>

            <div className="flex flex-col gap-1">
              <a
                href={`/product-profile/${state.profile.id}/final-html`}
                target="_blank"
                rel="noreferrer"
                className="self-start text-xs text-blue-600 underline underline-offset-2 dark:text-blue-400"
              >
                최종 상세페이지 새 탭에서 열기 (방금 저장된 결과)
              </a>
              <a
                href={`${API_URL}/product-profile/${state.profile.id}/final-html`}
                target="_blank"
                rel="noreferrer"
                className="self-start text-xs text-zinc-500 underline underline-offset-2 dark:text-zinc-400"
              >
                원본 HTML 파일로 다운로드 (이미지 포함 — 용량이 큼)
              </a>
            </div>
            <iframe
              title="최종 상세페이지 미리보기"
              srcDoc={`<style>${state.result.css}</style>${state.result.html}`}
              sandbox=""
              className="h-[640px] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
            />
          </div>
        )}
      </div>
    </Card>
  );
}
