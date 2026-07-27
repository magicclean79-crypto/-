"use client";

import { useCallback, useRef, useState } from "react";
import {
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_MAX_FILES,
  UPLOAD_MAX_FILE_SIZE,
  type ImageDto,
} from "@acos/shared";
import { Badge } from "@acos/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type UploadStatus = "uploading" | "done" | "error";

interface UploadItem {
  id: string;
  fileName: string;
  fileSize: number;
  previewUrl: string;
  progress: number;
  status: UploadStatus;
  error?: string;
  result?: ImageDto;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

function uploadWithProgress(
  file: File,
  onProgress: (percent: number) => void,
): Promise<ImageDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("files", file);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as {
          images?: ImageDto[];
          message?: string | string[];
        };
        if (xhr.status >= 200 && xhr.status < 300 && body.images?.[0]) {
          resolve(body.images[0]);
        } else {
          const message = Array.isArray(body.message)
            ? body.message.join(", ")
            : body.message;
          reject(new Error(message ?? `업로드 실패 (HTTP ${xhr.status})`));
        }
      } catch {
        reject(new Error(`업로드 실패 (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () =>
      reject(new Error("API 서버에 연결할 수 없습니다. (localhost:4000)"));
    xhr.open("POST", `${API_URL}/uploads/images`);
    xhr.send(formData);
  });
}

export function Uploader() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateItem = useCallback(
    (id: string, patch: Partial<UploadItem>) => {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const startUpload = useCallback(
    (files: File[]) => {
      const errors: string[] = [];
      const accepted: File[] = [];

      for (const file of files) {
        if (
          !(UPLOAD_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)
        ) {
          errors.push(`${file.name}: 지원하지 않는 형식 (${file.type || "unknown"})`);
        } else if (file.size > UPLOAD_MAX_FILE_SIZE) {
          errors.push(
            `${file.name}: 10MB 초과 (${formatBytes(file.size)})`,
          );
        } else {
          accepted.push(file);
        }
      }
      if (accepted.length > UPLOAD_MAX_FILES) {
        errors.push(`한 번에 최대 ${UPLOAD_MAX_FILES}개까지 업로드할 수 있습니다.`);
        accepted.length = UPLOAD_MAX_FILES;
      }
      setRejected(errors);

      for (const file of accepted) {
        const id = crypto.randomUUID();
        setItems((prev) => [
          {
            id,
            fileName: file.name,
            fileSize: file.size,
            previewUrl: URL.createObjectURL(file),
            progress: 0,
            status: "uploading" as const,
          },
          ...prev,
        ]);

        uploadWithProgress(file, (percent) =>
          updateItem(id, { progress: percent }),
        )
          .then((result) =>
            updateItem(id, { status: "done", progress: 100, result }),
          )
          .catch((error: Error) =>
            updateItem(id, { status: "error", error: error.message }),
          );
      }
    },
    [updateItem],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      startUpload(Array.from(event.dataTransfer.files));
    },
    [startUpload],
  );

  return (
    <div className="flex flex-col gap-6">
      <div
        role="button"
        tabIndex={0}
        aria-label="상품 사진 업로드"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
          isDragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
            : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
        }`}
      >
        <span className="text-4xl">📸</span>
        <p className="font-medium">
          상품 사진을 여기에 끌어다 놓거나 클릭해서 선택하세요
        </p>
        <p className="text-sm text-zinc-500">
          JPG · PNG · WebP · GIF, 파일당 최대 10MB, 한 번에 최대{" "}
          {UPLOAD_MAX_FILES}개
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ALLOWED_MIME_TYPES.join(",")}
          multiple
          className="hidden"
          onChange={(event) => {
            startUpload(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>

      {rejected.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <p className="mb-1 font-semibold">업로드할 수 없는 파일</p>
          <ul className="list-inside list-disc">
            {rejected.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              {/* blob 미리보기는 next/image 대신 <img>를 사용한다 */}
              <img
                src={item.previewUrl}
                alt={item.fileName}
                className="h-16 w-16 rounded-lg object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{item.fileName}</p>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {formatBytes(item.fileSize)}
                  </span>
                  {item.status === "uploading" && (
                    <Badge tone="warn">업로드 중 {item.progress}%</Badge>
                  )}
                  {item.status === "done" && <Badge tone="ok">완료</Badge>}
                  {item.status === "error" && <Badge tone="warn">실패</Badge>}
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={`h-full rounded-full transition-all ${
                      item.status === "error" ? "bg-red-500" : "bg-blue-500"
                    }`}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                {item.status === "done" && item.result && (
                  <a
                    href={item.result.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-xs text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {item.result.url}
                  </a>
                )}
                {item.status === "error" && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {item.error}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
