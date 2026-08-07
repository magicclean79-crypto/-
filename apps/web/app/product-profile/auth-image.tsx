"use client";

import { useEffect, useState } from "react";
import { authFetchInit } from "../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 인증이 필요한 이미지(GET /uploads/images/:id/file)를 <img>로 보여준다.
 * 쿠키 SameSite 제약 때문에 <img src="...">에 직접 API 주소를 넣으면
 * 브라우저가 인증 정보를 안 보낼 수 있다 — fetch(authFetchInit)로 받아
 * Blob URL로 바꿔서 보여준다(다운로드 버튼과 같은 방식).
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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    fetch(`${API_URL}/uploads/images/${imageId}/file`, authFetchInit())
      .then((response) =>
        response.ok ? response.blob() : Promise.reject(new Error(`HTTP ${response.status}`)),
      )
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId]);

  if (failed) {
    return (
      <div
        className={`${className ?? ""} flex items-center justify-center bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800`}
      >
        불러오기 실패
      </div>
    );
  }
  if (!src) {
    return <div className={`${className ?? ""} animate-pulse bg-zinc-200 dark:bg-zinc-800`} />;
  }
  return <img src={src} alt={alt} className={className} />;
}
