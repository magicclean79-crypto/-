import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 하지 않기로 한 것을 고정한다. (TASK-3101 — CTO 정책 3101-②③)
 *
 * **하지 않기로 한 일은 코드에 흔적이 없어서, 나중에 누가 "정확한 숫자를
 * 위해" 되살려도 아무도 모른다.** 그래서 없다는 사실 자체를 테스트로 남긴다
 * (TASK-2801 발행 경계와 같은 이유).
 *
 * 두 경계가 있다:
 *
 * 1. **비용 기록은 수정하지 않는다** (Append Only, 정책 3101-②) — 단가가
 *    바뀌었다고 과거 비용을 다시 계산하면 "그때 얼마였나"에 답할 수 없다.
 * 2. **예측은 차단에 쓰이지 않는다** (정책 3101-③) — 예측으로 호출을 막으면
 *    아직 쓰지 않은 돈 때문에 서비스가 멈춘다.
 */

const API_SRC = join(__dirname, "..");

const read = (relative: string) =>
  readFileSync(join(API_SRC, relative), "utf8");

/** src 아래 모든 구현 파일 (테스트 제외) */
function sourceFiles(dir: string = API_SRC): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...sourceFiles(full));
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".spec.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("비용 경계 — 하지 않기로 한 것 (TASK-3101)", () => {
  describe("비용 기록은 수정하지 않는다 (CTO 정책 3101-②)", () => {
    it("기록된 비용을 다시 쓰는 코드가 없다", () => {
      // 비용을 남기는 곳은 실행 기록을 만드는 경로 둘뿐이다:
      // Execution 생성(ExecutionTracker)과 OCR 성공 기록(markSuccess).
      // 그 외에 cost를 갱신하는 코드가 생기면 원장이 원장이 아니게 된다.
      const writers = sourceFiles()
        .filter((file) => {
          const code = readFileSync(file, "utf8");
          return (
            /execution\.update\(/.test(code) ||
            /execution\.updateMany\(/.test(code) ||
            /ocrResult\.updateMany\(/.test(code)
          );
        })
        .map((file) => file.replace(`${API_SRC}/`, ""));
      expect(writers).toEqual([]);
    });

    it("OCR 비용은 성공 기록 한 곳에서만 쓴다", () => {
      const store = read("ocr/prisma-ocr-run.store.ts");
      // 실패 기록은 비용을 적지 않는다 — 과금됐을 수도 있지만 우리는 모르고,
      // 모르는 것을 숫자로 적으면 예산이 거짓이 된다
      const failed = store.slice(store.indexOf("async markFailed"));
      expect(failed).not.toContain("cost");
      expect(store.match(/cost,/g)).toHaveLength(1);
    });

    it("단가 적용은 과거 기록을 건드리지 않는다", () => {
      const service = read("pricing/pricing.service.ts");
      // 적용은 제안 레코드의 단계만 바꾼다 — 원장을 다시 계산하는 경로가
      // 생기면 "그때 기준으로 맞았는가"를 물을 수 없다
      expect(service).not.toContain("execution.update");
      expect(service).not.toContain("ocrResult.update");
      expect(service).not.toContain("recalculate");
    });

    it("검증은 시점별 단가로 대조한다", () => {
      // 새 단가로 과거를 대조하면 단가를 한 번 바꿀 때마다 과거 전체가
      // 불일치로 보고되고, 그런 경보는 곧 무시된다
      expect(read("llm/provider-production.service.ts")).toContain(
        "resolvers()",
      );
      expect(read("pricing/pricing.service.ts")).toContain("resolvePricingAt");
    });

    it("적용된 제안의 단가를 나중에 고칠 수 없다", () => {
      const service = read("pricing/pricing.service.ts");
      // 단계 전이 코드가 price를 다시 쓰면 "무엇이 적용됐는가"가 흐려진다
      const advance = service.slice(
        service.indexOf("async advance"),
        service.indexOf("async board"),
      );
      expect(advance).not.toContain("data.price");
      expect(advance).not.toContain("price:");
    });
  });

  describe("예측은 차단에 쓰이지 않는다 (CTO 정책 3101-③)", () => {
    it("예산 관문은 예측을 모른다", () => {
      const budget = read("llm/llm-budget.service.ts");
      expect(budget).not.toContain("forecast");
      expect(budget).not.toContain("Forecast");
      expect(budget).not.toContain("CostIntelligence");
    });

    it("차단은 실제 지출 원장만 읽는다", () => {
      const budget = read("llm/llm-budget.service.ts");
      // 두 원장의 aggregate — 그 외 입력이 차단 판단에 섞이지 않는다
      expect(budget).toContain("execution.aggregate");
      expect(budget).toContain("ocrResult.aggregate");
    });

    it("예측을 만드는 쪽도 아무것도 던지지 않는다", () => {
      const costs = read("ops/cost-intelligence.service.ts");
      // 예측 결과로 예외를 던지면 그것이 곧 차단이다
      expect(costs).not.toContain("TOO_MANY_REQUESTS");
      expect(costs).not.toContain("markNoFailover");
    });
  });
});
