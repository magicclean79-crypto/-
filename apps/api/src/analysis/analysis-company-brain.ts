import type { AnalysisCompanyBrainSource } from "@acos/core";
import type {
  CompanyBrainQueryResponse,
  CompanyBrainSource,
  DecisionDto,
  KnowledgeDto,
  MemoryDto,
} from "@acos/shared";
import { CompanyBrainService } from "../company-brain/company-brain.service";

function sectionItems<T>(
  response: CompanyBrainQueryResponse,
  source: CompanyBrainSource,
): T[] {
  const section = response.results.find((item) => item.source === source);
  return (section?.items ?? []) as T[];
}

/**
 * Company Brain → 상품 분석 컨텍스트 어댑터 (TASK-0504).
 * 상품 이름을 질의어로 PROJECT 스코프를 조회한다 — Content Generation과
 * 같은 기준(상품 제목 기준 검색, TASK-0502 CTO 결정)을 따른다.
 */
export function createAnalysisCompanyBrainSource(
  companyBrain: CompanyBrainService,
): AnalysisCompanyBrainSource {
  return async (input) => {
    const query = input.product.name.trim();
    if (query.length === 0) {
      return { knowledge: [], decisions: [], memories: [] };
    }

    const response = await companyBrain.query({
      query,
      scope: "PROJECT",
      scopeId: input.product.projectId,
    });
    return {
      knowledge: sectionItems<KnowledgeDto>(response, "KNOWLEDGE").map(
        (item) => ({
          title: item.title,
          content: item.content,
          category: item.category,
        }),
      ),
      decisions: sectionItems<DecisionDto>(response, "DECISION").map(
        (item) => ({ title: item.title, reason: item.reason }),
      ),
      memories: sectionItems<MemoryDto>(response, "MEMORY").map((item) => ({
        key: item.key,
        value: item.value,
        description: item.description,
      })),
    };
  };
}
