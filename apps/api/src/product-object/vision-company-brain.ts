import type { VisionCompanyBrainSource } from "@acos/core";
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
 * Company Brain → Vision 분석 컨텍스트 어댑터 (TASK-0505).
 * 프로젝트 이름을 질의어로 PROJECT 스코프를 조회한다 — Analysis(TASK-0504)의
 * 상품 이름 기준 조회와 같은 결의 이름 기준 검색이다.
 */
export function createVisionCompanyBrainSource(
  companyBrain: CompanyBrainService,
): VisionCompanyBrainSource {
  return async (input) => {
    const query = input.project.name.trim();
    if (query.length === 0) {
      return { knowledge: [], decisions: [], memories: [] };
    }

    const response = await companyBrain.query({
      query,
      scope: "PROJECT",
      scopeId: input.project.id,
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
