"use client";

import { useEffect, useState } from "react";
import { Badge } from "@acos/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function ApiStatus() {
  const [status, setStatus] = useState<"checking" | "ok" | "down">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/health`)
      .then((res) => res.text())
      .then((text) => {
        if (!cancelled) setStatus(text === "OK" ? "ok" : "down");
      })
      .catch(() => {
        if (!cancelled) setStatus("down");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex items-center gap-2">
      <span>{API_URL}/health</span>
      {status === "checking" && <Badge tone="warn">확인 중…</Badge>}
      {status === "ok" && <Badge tone="ok">OK</Badge>}
      {status === "down" && <Badge tone="warn">응답 없음</Badge>}
    </div>
  );
}
