"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Level1AssetDto,
  Level1AssetRole,
  Level1ProductDto,
  Level1ProjectDto,
  UpsertLevel1ProductRequest,
} from "@acos/shared";
import { LEVEL1_API_URL, Level1ApiError, level1Fetch } from "./level1-client";

const ASSET_ROLE_LABEL: Record<Level1AssetRole, string> = {
  ACTUAL_PRODUCT: "실제 제품",
  PACKAGING: "포장",
  LABEL: "라벨",
  SPEC: "사양표",
  BARCODE: "바코드",
  MANUAL: "설명서",
  LIFESTYLE: "사용 장면",
  UNKNOWN: "미지정",
};

const ASSET_ROLES = Object.keys(ASSET_ROLE_LABEL) as Level1AssetRole[];

const FACT_FIELDS: { key: keyof UpsertLevel1ProductRequest; label: string; kind: "text" | "list" }[] = [
  { key: "name", label: "제품명", kind: "text" },
  { key: "brand", label: "브랜드", kind: "text" },
  { key: "model", label: "모델명", kind: "text" },
  { key: "category", label: "카테고리", kind: "text" },
  { key: "materials", label: "재질 (쉼표로 구분)", kind: "list" },
  { key: "colors", label: "색상 (쉼표로 구분)", kind: "list" },
  { key: "dimensions", label: "규격/치수", kind: "text" },
  { key: "includedComponents", label: "구성품 (쉼표로 구분)", kind: "list" },
  { key: "origin", label: "원산지", kind: "text" },
  { key: "claims", label: "표기 사항 (쉼표로 구분)", kind: "list" },
];

function toListText(value: string[] | undefined | null): string {
  return (value ?? []).join(", ");
}

function parseListText(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

type FactFormState = Record<string, string>;

function factFormFromProduct(product: Level1ProductDto): FactFormState {
  const state: FactFormState = {};
  for (const field of FACT_FIELDS) {
    const value = product[field.key as keyof Level1ProductDto];
    state[field.key] = field.kind === "list" ? toListText(value as string[]) : (value as string | null) ?? "";
  }
  return state;
}

export default function Level1View() {
  const [projects, setProjects] = useState<Level1ProjectDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");

  const [products, setProducts] = useState<Level1ProductDto[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const [factForm, setFactForm] = useState<FactFormState | null>(null);
  const [uncertainFields, setUncertainFields] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [assets, setAssets] = useState<Level1AssetDto[]>([]);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? null;

  const loadProjects = useCallback(async () => {
    try {
      const list = await level1Fetch<Level1ProjectDto[]>("/level1/projects");
      setProjects(list);
      setLoadError(null);
    } catch (err) {
      setProjects(null);
      setLoadError(err instanceof Level1ApiError ? err.message : "프로젝트 목록을 불러올 수 없습니다.");
    }
  }, []);

  const loadProducts = useCallback(async (projectId: string) => {
    try {
      const list = await level1Fetch<Level1ProductDto[]>(`/level1/projects/${projectId}/products`);
      setProducts(list);
    } catch (err) {
      setLoadError(err instanceof Level1ApiError ? err.message : "제품 목록을 불러올 수 없습니다.");
    }
  }, []);

  const loadAssets = useCallback(async (productId: string) => {
    try {
      const list = await level1Fetch<Level1AssetDto[]>(`/level1/products/${productId}/assets`);
      setAssets(list);
    } catch {
      setAssets([]);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (selectedProjectId) {
      void loadProducts(selectedProjectId);
      setSelectedProductId(null);
    } else {
      setProducts([]);
    }
  }, [selectedProjectId, loadProducts]);

  // selectedProductId가 바뀔 때만 폼을 다시 채운다 — selectedProduct 자체를
  // 의존성으로 두면, 저장 성공 후 products 갱신으로 selectedProduct 참조가
  // 바뀌면서 이 effect가 다시 돌아 "저장됨" 상태를 곧바로 "idle"로 되돌렸다.
  useEffect(() => {
    if (selectedProduct) {
      setFactForm(factFormFromProduct(selectedProduct));
      setUncertainFields(new Set(selectedProduct.uncertainFields));
      setNotes(selectedProduct.notes ?? "");
      void loadAssets(selectedProduct.id);
    } else {
      setFactForm(null);
      setAssets([]);
    }
    setSaveStatus("idle");
    setSaveError(null);
  }, [selectedProductId, loadAssets]);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const project = await level1Fetch<Level1ProjectDto>("/level1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setNewProjectName("");
      await loadProjects();
      setSelectedProjectId(project.id);
    } catch (err) {
      setLoadError(err instanceof Level1ApiError ? err.message : "프로젝트를 만들 수 없습니다.");
    }
  }

  async function handleCreateProduct() {
    if (!selectedProjectId) return;
    try {
      const product = await level1Fetch<Level1ProductDto>(
        `/level1/projects/${selectedProjectId}/products`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      );
      await loadProducts(selectedProjectId);
      setSelectedProductId(product.id);
    } catch (err) {
      setLoadError(err instanceof Level1ApiError ? err.message : "제품을 만들 수 없습니다.");
    }
  }

  function updateFactField(key: string, value: string) {
    setFactForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function toggleUncertain(key: string) {
    setUncertainFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSaveFacts() {
    if (!selectedProduct || !factForm) return;
    setSaveStatus("saving");
    setSaveError(null);
    const body: UpsertLevel1ProductRequest = { notes: notes.trim() || null, uncertainFields: [...uncertainFields] };
    for (const field of FACT_FIELDS) {
      const raw = factForm[field.key] ?? "";
      if (field.kind === "list") {
        (body as Record<string, unknown>)[field.key] = parseListText(raw);
      } else {
        (body as Record<string, unknown>)[field.key] = raw.trim() || null;
      }
    }
    try {
      const updated = await level1Fetch<Level1ProductDto>(`/level1/products/${selectedProduct.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Level1ApiError ? err.message : "저장할 수 없습니다.");
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!selectedProduct || !files || files.length === 0) return;
    setUploadStatus("uploading");
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        await level1Fetch<Level1AssetDto>(`/level1/products/${selectedProduct.id}/assets`, {
          method: "POST",
          body: formData,
        });
      }
      await loadAssets(selectedProduct.id);
      setUploadStatus("idle");
    } catch (err) {
      setUploadStatus("error");
      setUploadError(err instanceof Level1ApiError ? err.message : "업로드할 수 없습니다.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRoleChange(assetId: string, role: Level1AssetRole) {
    try {
      const updated = await level1Fetch<Level1AssetDto>(`/level1/assets/${assetId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      setUploadError(err instanceof Level1ApiError ? err.message : "역할을 바꿀 수 없습니다.");
    }
  }

  async function handleDeleteAsset(assetId: string) {
    try {
      await level1Fetch<{ ok: true }>(`/level1/assets/${assetId}`, { method: "DELETE" });
      setAssets((prev) => prev.filter((a) => a.id !== assetId));
    } catch (err) {
      setUploadError(err instanceof Level1ApiError ? err.message : "삭제할 수 없습니다.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-16">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">LEVEL 1 — 제품 정보 기반</h1>
        <p className="mt-1 text-sm text-zinc-500">
          제품 사실 입력과 실제 제품 사진 보관만 다루는 새 파이프라인의 최소 기반입니다. 디자인·이미지
          생성은 다음 레벨에서 다룹니다.
        </p>
      </div>

      {loadError && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {loadError}
        </p>
      )}

      {/* 1. 프로젝트 생성/선택 */}
      <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="font-semibold">1. 프로젝트 생성/선택</h2>
        <form onSubmit={handleCreateProject} className="mt-3 flex gap-2">
          <input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="새 프로젝트 이름"
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            만들기
          </button>
        </form>

        <ul className="mt-4 flex flex-col gap-2">
          {(projects ?? []).map((project) => (
            <li key={project.id}>
              <button
                type="button"
                onClick={() => setSelectedProjectId(project.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                  selectedProjectId === project.id
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                {project.name} <span className="text-zinc-500">· 제품 {project.productCount}개</span>
              </button>
            </li>
          ))}
          {projects && projects.length === 0 && (
            <p className="text-sm text-zinc-500">아직 프로젝트가 없습니다.</p>
          )}
        </ul>
      </section>

      {/* 2. 제품 생성/선택 */}
      {selectedProjectId && (
        <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">2. 제품 생성/선택</h2>
            <button
              type="button"
              onClick={handleCreateProduct}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              + 새 제품
            </button>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {products.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => setSelectedProductId(product.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    selectedProductId === product.id
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  {product.name ?? "(제품명 미입력)"}{" "}
                  <span className="text-zinc-500">· 사진 {product.assetCount}장</span>
                </button>
              </li>
            ))}
            {products.length === 0 && <p className="text-sm text-zinc-500">아직 제품이 없습니다.</p>}
          </ul>
        </section>
      )}

      {/* 3. 제품 기본정보 */}
      {selectedProduct && factForm && (
        <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="font-semibold">3. 제품 기본정보 — 확인된 사실만 입력합니다</h2>
          <p className="mt-1 text-xs text-zinc-500">
            모르는 값은 비워 둡니다. AI가 추측해 채우지 않습니다. 값이 있어도 확실하지 않으면
            &quot;미확정&quot;에 체크하세요.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FACT_FIELDS.map((field) => (
              <div key={field.key} className="flex flex-col gap-1">
                <label className="flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  <span>{field.label}</span>
                  <span className="flex items-center gap-1 font-normal">
                    <input
                      type="checkbox"
                      checked={uncertainFields.has(field.key)}
                      onChange={() => toggleUncertain(field.key)}
                    />
                    미확정
                  </span>
                </label>
                <input
                  value={factForm[field.key] ?? ""}
                  onChange={(e) => updateFactField(field.key, e.target.value)}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              메모 (출처·근거 등)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveFacts}
              disabled={saveStatus === "saving"}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saveStatus === "saving" ? "저장 중…" : "저장"}
            </button>
            {saveStatus === "saved" && <span className="text-sm text-green-600">저장됨</span>}
            {saveStatus === "error" && <span className="text-sm text-red-600">{saveError}</span>}
          </div>
        </section>
      )}

      {/* 4. 실제 제품 사진 업로드/선택 + asset role */}
      {selectedProduct && (
        <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="font-semibold">4. 실제 제품 사진 — 업로드 및 역할 지정</h2>
          <div className="mt-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={(e) => void handleUpload(e.target.files)}
              disabled={uploadStatus === "uploading"}
            />
            {uploadStatus === "uploading" && <p className="mt-1 text-sm text-zinc-500">업로드 중…</p>}
            {uploadStatus === "error" && <p className="mt-1 text-sm text-red-600">{uploadError}</p>}
          </div>

          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {assets.map((asset) => (
              <li key={asset.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
                <img
                  src={`${LEVEL1_API_URL}/level1/assets/${asset.id}/file`}
                  alt={asset.originalName}
                  className="aspect-square w-full rounded object-cover"
                />
                <p className="truncate text-xs text-zinc-500" title={asset.originalName}>
                  {asset.originalName}
                </p>
                <select
                  value={asset.role}
                  onChange={(e) => void handleRoleChange(asset.id, e.target.value as Level1AssetRole)}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {ASSET_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ASSET_ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleDeleteAsset(asset.id)}
                  className="text-xs text-red-600 hover:underline"
                >
                  삭제
                </button>
              </li>
            ))}
            {assets.length === 0 && <p className="text-sm text-zinc-500">아직 업로드한 사진이 없습니다.</p>}
          </ul>
        </section>
      )}

      {/* 5. 다음 레벨 — LEVEL 1 범위 밖 */}
      {selectedProduct && (
        <section className="rounded-xl border border-dashed border-zinc-300 p-5 text-zinc-500 dark:border-zinc-700">
          <button type="button" disabled className="cursor-not-allowed rounded-lg bg-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-500">
            상세페이지 디자인 생성 (LEVEL 2 이상 — 아직 만들지 않음)
          </button>
        </section>
      )}
    </main>
  );
}
