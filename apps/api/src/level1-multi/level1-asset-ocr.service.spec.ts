import type { OcrProvider, OcrRecognition, OcrRun, OcrRunStore } from "@acos/core";
import { Level1AssetOcrService } from "./level1-asset-ocr.service";
import type { StorageService } from "../storage/storage.service";
import type { Level1AssetOcrStore } from "./level1-asset-ocr.store";

function makeStorageMock(bytesByKey: Record<string, Buffer> = {}) {
  return {
    getObject: jest.fn(async (key: string) => bytesByKey[key] ?? Buffer.from("bytes")),
  };
}

/** 실제 DB 없이 OcrRunStore를 흉내 내는 인메모리 구현 — Level1AssetOcrStore와 같은 계약만 만족하면 된다. */
function makeInMemoryStore(): OcrRunStore & { runs: Map<string, OcrRun> } {
  const runs = new Map<string, OcrRun>();
  let seq = 0;
  return {
    runs,
    async start(imageId, provider) {
      seq += 1;
      const run: OcrRun = {
        id: `run-${seq}`,
        imageId,
        provider,
        status: "RUNNING",
        extractedText: null,
        confidence: null,
        rawJson: null,
        error: null,
        attempts: 0,
        startedAt: new Date(),
        completedAt: null,
      };
      runs.set(run.id, run);
      return run;
    },
    async markSuccess(id, result: OcrRecognition, attempts) {
      const run = { ...runs.get(id)!, status: "SUCCESS" as const, extractedText: result.text, confidence: result.confidence, rawJson: result.raw, attempts };
      runs.set(id, run);
      return run;
    },
    async markFailed(id, error, attempts) {
      const run = { ...runs.get(id)!, status: "FAILED" as const, error, attempts };
      runs.set(id, run);
      return run;
    },
  };
}

describe("Level1AssetOcrService", () => {
  it("여러 asset을 병렬로 OCR하고 각각의 결과를 반환한다", async () => {
    const storage = makeStorageMock();
    const store = makeInMemoryStore();
    const provider: OcrProvider = {
      name: "test-provider",
      recognize: jest.fn(async (_bytes, mimeType) => ({
        text: `text for ${mimeType}`,
        confidence: 0.8,
        raw: { mimeType },
      })),
    };
    const service = new Level1AssetOcrService(
      storage as unknown as StorageService,
      store as unknown as Level1AssetOcrStore,
      provider,
    );

    const outcomes = await service.runForAssets([
      { id: "a1", objectKey: "k1", mimeType: "image/jpeg" },
      { id: "a2", objectKey: "k2", mimeType: "image/png" },
    ]);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.find((o) => o.assetId === "a1")).toMatchObject({
      status: "SUCCESS",
      text: "text for image/jpeg",
      confidence: 0.8,
    });
    expect(outcomes.find((o) => o.assetId === "a2")).toMatchObject({
      status: "SUCCESS",
      text: "text for image/png",
    });
  });

  it("한 asset의 OCR이 실패해도 나머지는 계속 진행한다", async () => {
    const storage = makeStorageMock();
    const store = makeInMemoryStore();
    const provider: OcrProvider = {
      name: "test-provider",
      recognize: jest.fn(async (_bytes, mimeType) => {
        if (mimeType === "image/jpeg") throw new Error("인식 실패");
        return { text: "정상 인식", confidence: 0.5, raw: {} };
      }),
    };
    const service = new Level1AssetOcrService(
      storage as unknown as StorageService,
      store as unknown as Level1AssetOcrStore,
      provider,
    );

    const outcomes = await service.runForAssets([
      { id: "bad", objectKey: "k1", mimeType: "image/jpeg" },
      { id: "good", objectKey: "k2", mimeType: "image/png" },
    ]);

    expect(outcomes.find((o) => o.assetId === "bad")?.status).toBe("FAILED");
    expect(outcomes.find((o) => o.assetId === "good")?.status).toBe("SUCCESS");
  });

  it("빈 asset 목록이면 빈 결과를 즉시 반환한다", async () => {
    const storage = makeStorageMock();
    const store = makeInMemoryStore();
    const provider: OcrProvider = { name: "test-provider", recognize: jest.fn() };
    const service = new Level1AssetOcrService(
      storage as unknown as StorageService,
      store as unknown as Level1AssetOcrStore,
      provider,
    );

    expect(await service.runForAssets([])).toEqual([]);
    expect(provider.recognize).not.toHaveBeenCalled();
  });
});
