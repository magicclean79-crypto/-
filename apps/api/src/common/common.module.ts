import { Global, Module } from "@nestjs/common";
import { RequestContextService } from "./request-context.service";

/**
 * 요청 추적 컨텍스트를 어디서나 쓸 수 있게 한다. (TASK-3601, CTO 정책 3601-②)
 *
 * `@Global`인 이유: 호출 지점이 여러 모듈에 흩어져 있고, 모듈마다 import를
 * 더하게 하면 **하나 빠뜨린 모듈만 조용히 추적이 끊깁니다.**
 */
@Global()
@Module({
  providers: [RequestContextService],
  exports: [RequestContextService],
})
export class CommonModule {}
