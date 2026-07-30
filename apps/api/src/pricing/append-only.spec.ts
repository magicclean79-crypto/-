import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 하지 않기로 한 것을 고정한다. (TASK-3101 — CTO 정책 3101-②③)
 *
 * **하지 않기로 한 일은 코드에 흔적이 없어서, 나중에 누가 "정확한 숫자를
 * 위해" 되살려도 아무도 모른다.** 그래서 없다는 사실 자체를 테스트로 남긴다
 * (TASK-2801 발행 경계와 같은 이유).
 *
 * 세 경계가 있다:
 *
 * 1. **비용 기록은 수정하지 않는다** (Append Only, 정책 3101-②) — 단가가
 *    바뀌었다고 과거 비용을 다시 계산하면 "그때 얼마였나"에 답할 수 없다.
 * 2. **예측은 차단에 쓰이지 않는다** (정책 3101-③ · 3201-④) — 예측으로 호출을
 *    막으면 아직 쓰지 않은 돈 때문에 서비스가 멈춘다. Alert만 낸다.
 * 3. **감지는 적용이 아니다** (정책 3201-①) — 자동화는 제안까지만 만든다.
 *    자동 적용을 허용하면 Provider 쪽 이상이나 우리 계산 오류가 곧바로 돈의
 *    기준을 바꾸고, 그 뒤의 모든 숫자가 설명 불가능해진다.
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

describe("비용 경계 — 하지 않기로 한 것 (TASK-3101 · 3201)", () => {
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

  describe("감지는 적용이 아니다 (CTO 정책 3201-①)", () => {
    it("감지가 만드는 것은 DETECTED 제안뿐이다", () => {
      const service = read("pricing/pricing.service.ts");
      const detect = service.slice(
        service.indexOf("async detect("),
        service.indexOf("async resolvers("),
      );
      // 자동 적용을 허용하면 Provider 쪽 이상이나 우리 계산 오류가 곧바로
      // 돈의 기준을 바꾼다. 감지가 **쓰는** 것은 제안 한 건뿐이므로,
      // 저장 payload 자체를 본다 (읽기는 발효 창 계산에 필요하다).
      const payload = detect.slice(
        detect.indexOf("pricingProposal.create({"),
        detect.indexOf("created.push("),
      );
      expect(payload).toContain('startStage("detected")');
      expect(payload).not.toContain("APPLIED");
      expect(payload).not.toContain("appliedBy");
      expect(payload).not.toContain("appliedAt");
      // 발효 시각은 적용할 때 정해진다 — 감지가 정하면 자동 적용이 된다
      expect(payload).not.toContain("effectiveFrom");
    });

    it("감지된 제안도 사람의 승인을 거친다", () => {
      // 단계 표에 DETECTED → APPLIED가 없다는 사실이 그 보장이다
      const governance = readFileSync(
        join(API_SRC, "..", "..", "..", "packages/core/src/ops/pricing-governance.ts"),
        "utf8",
      );
      expect(governance).toContain('DETECTED: ["APPROVED", "REJECTED"]');
    });

    it("자기 승인 판정은 환경을 인자로 받는다 — core가 환경을 읽지 않는다", () => {
      // core가 환경을 직접 읽으면 같은 판정이 테스트에서 재현되지 않는다.
      // 주석에는 그 이유가 적혀 있으므로 **코드에서만** 없음을 확인한다.
      const code = readFileSync(
        join(API_SRC, "..", "..", "..", "packages/core/src/ops/pricing-governance.ts"),
        "utf8",
      ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code).not.toContain("process.env");
    });
  });

  describe("예측은 차단에 쓰이지 않는다 (CTO 정책 3101-③ · 3201-④)", () => {
    it("예측 점검은 예산 관문을 부르지 않는다", () => {
      const checks = read("ops/scheduled-checks.service.ts");
      const branch = checks.slice(
        checks.indexOf('if (job === "cost-forecast")'),
        checks.indexOf("// health-check"),
      );
      // 알리는 것과 막는 것은 다르다 — 예측 경보 경로에 차단이 섞이면
      // "경보만"이라는 정책이 코드에서 무너진다
      expect(branch).toContain("detectForecastAlerts");
      expect(branch).not.toContain("assertWithinBudget");
      expect(branch).not.toContain("TOO_MANY_REQUESTS");
    });

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
