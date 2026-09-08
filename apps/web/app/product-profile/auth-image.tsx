"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetchInit } from "../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * 인증이 필요한 이미지(GET /uploads/images/:id/file)를 <img>로 보여준다.
 * 쿠키 SameSite 제약 때문에 <img src="...">에 직접 API 주소를 넣으면
 * 브라우저가 인증 정보를 안 보낼 수 있다 — fetch(authFetchInit)로 받아
 * Blob URL로 바꿔서 보여준다(다운로드 버튼과 같은 방식).
 *
 * 실패 시 항상 "불러오기 실패"만 보여주면 원인(HTTP 상태·네트워크
 * 오류·잘못된 imageId 등)을 알 수 없다 (T1-114). 개발환경에서는
 * console.error에 원인을 남기고 화면에도 원인 요약을 함께 보여준다 —
 * 운영에서는 내부 정보(URL·상태 코드) 없이 재시도 버튼만 제공한다.
 */
export function AuthImage({
  imageId,
  alt,
  className,
}: {
  imageId: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setFailReason(null);
    setSrc(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    const url = `${API_URL}/uploads/images/${imageId}/file`;

    fetch(url, authFetchInit())
      .then((response) =>
        response.ok
          ? response.blob()
          : Promise.reject(new Error(`HTTP ${response.status} ${response.statusText}`)),
      )
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const reason = err instanceof Error ? err.message : "알 수 없는 오류";
        if (IS_DEV) {
          console.error(`[AuthImage] 이미지 로딩 실패: ${url} — ${reason}`);
        }
        setFailReason(reason);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId, attempt]);

  if (failReason) {
    return (
      <div
        className={`${className ?? ""} flex flex-col items-center justify-center gap-1 bg-zinc-100 p-1 text-center text-xs text-zinc-400 dark:bg-zinc-800`}
      >
        <span>불러오기 실패</span>
        {IS_DEV && <span className="break-all text-[10px] text-red-500">{failReason}</span>}
        <button
          type="button"
          onClick={retry}
          className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-200 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          다시 시도
        </button>
      </div>
    );
  }
  if (!src) {
    return <div className={`${className ?? ""} animate-pulse bg-zinc-200 dark:bg-zinc-800`} />;
  }
  return <img src={src} alt={alt} className={className} />;
}
