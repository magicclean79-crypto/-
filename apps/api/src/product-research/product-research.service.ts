import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  filterOfficialResults,
  planProductResearch,
  type ExcludedResearchResult,
  type ProductIdentification,
  type ProductResearchResult,
  type ResearchFinding,
  type ResearchTarget,
} from "@acos/core";
import { LlmBudgetService } from "../llm/llm-budget.service";
import { WEB_RESEARCH_PROVIDER, type WebResearchProvider } from "./web-research-provider";

/**
 * 제품 자동 조사 서비스. (T1-22)
 *
 * 제품이 식별된 경우에만(`ProductIdentification.identified`) 수행한다 —
 * 식별되지 않았으면 조사 자체를 생략한다(T1-22 지시). 우선순위 상위
 * 단계(바코드 → 모델명 → 브랜드 → 홈페이지 → 카탈로그)에서 공식 출처를
 * 찾으면 **그 자리에서 멈춘다** — 이미 확인된 뒤에도 다음 단계를 계속
 * 조사하면 비용만 나간다(`docs/PROJECT_MEMORY.md` "API 비용 최소화").
 */
@Injectable()
export class ProductResearchService {
  private readonly logger = new Logger(ProductResearchService.name);

  constructor(
    @Inject(WEB_RESEARCH_PROVIDER) private readonly provider: WebResearchProvider,
    // AI 비용 예산 — LLM·OCR과 같은 상한을 공유한다 (TASK-3001과 같은 판단)
    @Optional() private readonly budget?: LlmBudgetService,
  ) {}

  async research(identification: ProductIdentification): Promise<ProductResearchResult> {
    const targets = planProductResearch(identification);
    if (targets.length === 0) {
      return {
        status: "skipped",
        reason:
          "제품이 특정되지 않았습니다(바코드 없음, 브랜드·품명·모델명 미확인) — 조사를 생략합니다.",
        targetsAttempted: [],
        findings: [],
        excluded: [],
      };
    }

    // 실제 검색 Provider가 켜져 있을 때만 예산을 확인한다 — none Provider는
    // 비용이 없으므로 검사할 이유가 없다.
    if (this.provider.name !== "none") {
      await this.budget?.assertWithinBudget({ what: "제품 자동 조사(웹 검색)" });
    }

    const targetsAttempted: ResearchTarget[] = [];
    const findings: ResearchFinding[] = [];
    const excluded: ExcludedResearchResult[] = [];

    for (const target of targets) {
      targetsAttempted.push(target);
      const raw = await this.provider.search(target);
      const result = filterOfficialResults(target, raw, identification);
      findings.push(...result.findings);
      excluded.push(...result.excluded);

      if (result.findings.length > 0) {
        this.logger.log(
          `제품 자동 조사: "${target.type}" 단계에서 공식 출처 ${result.findings.length}건을 확인해 이후 단계는 생략합니다.`,
        );
        break;
      }
    }

    const lastTarget = targetsAttempted[targetsAttempted.length - 1];
    return {
      status: findings.length > 0 ? "found" : "not_found",
      reason:
        findings.length > 0
          ? `"${lastTarget.type}" 조사에서 공식 출처를 확인했습니다.`
          : this.provider.name === "none"
            ? "조사 Provider가 설정되지 않아(WEB_RESEARCH_PROVIDER=none) 실제 검색을 수행하지 않았습니다."
            : "시도한 모든 단계에서 공식 출처를 찾지 못했습니다.",
      targetsAttempted,
      findings,
      excluded,
    };
  }
}
