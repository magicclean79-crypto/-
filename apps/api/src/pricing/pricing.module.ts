import { Module } from "@nestjs/common";
import { PriceSourceService } from "./price-source.service";
import { PricingHealthService } from "./pricing-health.service";
import { PricingCacheBus } from "./pricing-cache.bus";
import { PricingService } from "./pricing.service";

/**
 * 가격표 거버넌스 모듈. (TASK-3101, Sprint 31 — CTO 정책 3101-①)
 *
 * 단가는 비용을 계산하는 모든 경로(LLM Execution · OCR 실행 이력 · 비용 검증 ·
 * 리포트)가 함께 쓴다. 그래서 **모듈 하나가 단가의 단일 출처**가 된다 —
 * 경로마다 가격표를 따로 읽으면 어느 한쪽이 조용히 낡고, 그때부터 같은 호출의
 * 비용이 화면마다 다르게 보인다.
 *
 * 이 모듈은 Prisma 외에 아무것도 의존하지 않는다 (LLM·OCR·Ops가 이 모듈을
 * 가져다 쓰는 방향이다).
 */
@Module({
  // 적용 즉시 캐시를 무효화한다 (TASK-3201, CTO 정책 3201-⑤) — 버스는
  // Redis가 있을 때만 실제로 전파하고, 없으면 단일 인스턴스 모드다
  // 외부 가격 공지 (TASK-3301, CTO 정책 3301-①) — 못 읽으면 사람을 부른다
  // 가격표를 얼마나 믿을 수 있는가 (TASK-4701, 지시 5) — 단가의 나이와
  // 가격표에 없는 모델을 **이름으로** 드러낸다
  providers: [PricingService, PricingCacheBus, PriceSourceService, PricingHealthService],
  exports: [
    PricingService,
    PricingCacheBus,
    PriceSourceService,
    PricingHealthService,
  ],
})
export class PricingModule {}
