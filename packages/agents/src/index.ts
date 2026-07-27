import type { ProductDto } from "@acos/shared";

export interface AgentContext {
  product: ProductDto;
  instructions?: string;
}

export interface AgentResult {
  title: string;
  body: string;
}

export interface ContentAgent {
  readonly name: string;
  generate(context: AgentContext): Promise<AgentResult>;
}

/**
 * LLM 연동 전까지 사용하는 자리표시자 에이전트.
 */
export class DraftWriterAgent implements ContentAgent {
  readonly name = "draft-writer";

  async generate(context: AgentContext): Promise<AgentResult> {
    return {
      title: `${context.product.name} 소개`,
      body: `${context.product.name}에 대한 콘텐츠 초안입니다.`,
    };
  }
}
