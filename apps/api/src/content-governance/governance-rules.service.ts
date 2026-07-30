import { Injectable, Logger } from "@nestjs/common";
import { parseBannedWords, parseDisclosures } from "@acos/core";
import type { DisclosureRule, RuleSource } from "@acos/core";
import type {
  CompanyBrainQueryResponse,
  CompanyBrainSource,
  KnowledgeDto,
  MemoryDto,
} from "@acos/shared";
import { CompanyBrainService } from "../company-brain/company-brain.service";

/** 금지어 목록이 사는 곳 — 키를 두 곳에 적으면 한 곳만 바뀐다 */
export const BANNED_WORDS_KEY = "banned-words";
/** 필수 고지 규칙이 사는 곳 */
export const DISCLOSURES_KEY = "required-disclosures";

function sectionItems<T>(
  response: CompanyBrainQueryResponse,
  source: CompanyBrainSource,
): T[] {
  const section = response.results.find((item) => item.source === source);
  return (section?.items ?? []) as T[];
}

/**
 * 거버넌스 규칙 읽기. (TASK-2501, Sprint 25)
 *
 * **규칙을 읽는 곳은 하나다.**
 *
 * READY 판정(TASK-0404)이 금지어를 읽는 코드를 자기 안에 갖고 있었고, 발행
 * 판정도 같은 것을 읽어야 했다. 두 곳이 각자 읽으면 **키가 달라지거나, 형식
 * 해석이 달라지거나, 한쪽만 새 규칙을 보게 된다** — 상품에서는 걸리는 말이
 * 콘텐츠에서는 안 걸리는 상태가 그렇게 만들어진다.
 *
 * 복구 판정을 단일 원천으로 모은 것(CTO 결정 2301-①)과 같은 이유다.
 */
@Injectable()
export class GovernanceRulesService {
  private readonly logger = new Logger(GovernanceRulesService.name);

  constructor(private readonly companyBrain: CompanyBrainService) {}

  /**
   * 금지어 목록 — 값과 **왜 못 읽었는지**를 함께 돌려준다.
   *
   * **형식이 틀린 것을 빈 목록으로 읽지 않는다** — 그러면 "위반 없음"이 된다.
   * 그리고 **미설정과 형식 오류를 구분한다**: 둘을 `null` 하나로 뭉개면 화면이
   * "설정되지 않았습니다"라고 말하게 되고, 운영자는 등록하러 갔다가 이미
   * 등록된 것을 발견한다. 틀렸다는 사실은 로그에도 남긴다.
   */
  async bannedWords(): Promise<{
    value: string[] | null;
    source: RuleSource;
  }> {
    const memory = await this.readGlobalMemory(BANNED_WORDS_KEY);
    if (memory === null) {
      return { value: null, source: "missing" };
    }
    const parsed = parseBannedWords(memory.value);
    if (parsed === null) {
      this.logger.warn(
        `금지어 목록 형식이 올바르지 않아 검사하지 못했습니다 — ` +
          `Memory(GLOBAL, ${BANNED_WORDS_KEY})는 문자열 배열이어야 합니다.`,
      );
      return { value: null, source: "invalid" };
    }
    return { value: parsed, source: "configured" };
  }

  /** 필수 고지 규칙 — 값과 왜 못 읽었는지를 함께 돌려준다 */
  async disclosures(): Promise<{
    value: DisclosureRule[] | null;
    source: RuleSource;
  }> {
    const memory = await this.readGlobalMemory(DISCLOSURES_KEY);
    if (memory === null) {
      return { value: null, source: "missing" };
    }
    const parsed = parseDisclosures(memory.value);
    if (parsed === null) {
      this.logger.warn(
        `필수 고지 규칙 형식이 올바르지 않아 검사하지 못했습니다 — ` +
          `Memory(GLOBAL, ${DISCLOSURES_KEY})는 {id, text} 객체 배열이어야 합니다.`,
      );
      return { value: null, source: "invalid" };
    }
    return { value: parsed, source: "configured" };
  }

  /**
   * 제목으로 검색한 RULE/LEGAL 지식.
   *
   * 제목이 비어 있으면 검색하지 않는다 — 빈 문자열로 검색하면 전체가 걸려
   * "검토가 필요한 규칙 40건"처럼 아무 뜻 없는 결과가 나온다.
   */
  async relatedRules(
    projectId: string,
    title: string,
  ): Promise<{ title: string; category: string | null }[]> {
    if (title.trim().length === 0) {
      return [];
    }
    const response = await this.companyBrain.query({
      query: title,
      scope: "PROJECT",
      scopeId: projectId,
    });
    return sectionItems<KnowledgeDto>(response, "KNOWLEDGE")
      .filter((item) => item.category === "RULE" || item.category === "LEGAL")
      .map((item) => ({ title: item.title, category: item.category }));
  }

  private async readGlobalMemory(key: string): Promise<MemoryDto | null> {
    const response = await this.companyBrain.query({
      query: key,
      scope: "GLOBAL",
    });
    return (
      sectionItems<MemoryDto>(response, "MEMORY").find(
        (item) => item.key === key,
      ) ?? null
    );
  }
}
