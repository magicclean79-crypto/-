import { Module } from "@nestjs/common";

import { AnalysisModule } from "../analysis/analysis.module";
import { CommonModule } from "../common/common.module";
import { ContentsModule } from "../contents/contents.module";
import { OcrModule } from "../ocr/ocr.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AuthModule } from "../auth/auth.module";
import { AllExceptionsFilter } from "./all-exceptions.filter";
import { AnalysisBatchJob } from "./analysis-batch.job";
import { ContentBatchJob } from "./content-batch.job";
import { JobContextService } from "./job-context.service";
import { JobLoggerService } from "./job-logger.service";
import { JobQueueService } from "./job-queue.service";
import { JobRegistryService } from "./job-registry.service";
import { JobRunnerService } from "./job-runner.service";
import { JobsController } from "./jobs.controller";
import { OcrBatchJob } from "./ocr-batch.job";
import { PublishBatchJob } from "./publish-batch.job";
import { TokenMeterService } from "./token-meter.service";

/**
 * 작업 신뢰성. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * 이 모듈은 **더하기만** 합니다. 기존 모듈을 고치지 않고, 기존 서비스를
 * 불러 쓸 뿐입니다 — `OcrModule`을 가져오되 그 안의 것을 바꾸지 않습니다.
 *
 * 전역 예외 필터를 여기서 `APP_FILTER`로 등록하지 않고 **`main.ts`에서
 * 직접** 붙이는 이유: 필터가 의존하는 두 컨텍스트(`RequestContextService` ·
 * `JobContextService`)가 요청보다 먼저 있어야 하고, 부트스트랩에서 붙이면
 * **어디에 붙었는지 한 곳만 보면 됩니다.**
 */
@Module({
  imports: [
    PrismaModule,
    CommonModule,
    OcrModule,
    AuthModule,
    // TASK-4701 지시 1 — 분석·생성·발행을 이 층에 태우기 위해 **불러 쓰기만**
    // 합니다. 세 모듈 안의 것은 하나도 바뀌지 않습니다.
    AnalysisModule,
    ContentsModule,
  ],
  controllers: [JobsController],
  providers: [
    JobContextService,
    JobLoggerService,
    JobRunnerService,
    TokenMeterService,
    JobRegistryService,
    JobQueueService,
    OcrBatchJob,
    AnalysisBatchJob,
    ContentBatchJob,
    PublishBatchJob,
    AllExceptionsFilter,
  ],
  exports: [
    JobContextService,
    JobLoggerService,
    JobRunnerService,
    TokenMeterService,
    JobRegistryService,
    AllExceptionsFilter,
  ],
})
export class ReliabilityModule {}
