import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AppController } from "./app.controller";
import { CommonModule } from "./common/common.module";
import { RequestContextMiddleware } from "./common/request-context.service";
import { HostObserverMiddleware } from "./ops/host-discovery.service";
import { AppService } from "./app.service";
import { AnalysisModule } from "./analysis/analysis.module";
import { AdminSettingsModule } from "./admin/admin-settings.module";
import { AdminModule } from "./admin/admin.module";
import { HealthModule } from "./health/health.module";
import { OpsModule } from "./ops/ops.module";
import { AuthModule } from "./auth/auth.module";
import { CompanyBrainModule } from "./company-brain/company-brain.module";
import { ContentsModule } from "./contents/contents.module";
import { DecisionsModule } from "./decisions/decisions.module";
import { ExecutionModule } from "./execution/execution.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { LlmModule } from "./llm/llm.module";
import { MemoryModule } from "./memory/memory.module";
import { ProjectMemoriesModule } from "./project-memories/project-memories.module";
import { OcrModule } from "./ocr/ocr.module";
// 작업 신뢰성 (TASK-4603) — 예외 분류·로그·체크포인트·계측. 더하기만 한다.
import { ReliabilityModule } from "./reliability/reliability.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProductObjectModule } from "./product-object/product-object.module";
import { ProductsModule } from "./products/products.module";
import { ProjectsModule } from "./projects/projects.module";
import { PromptModule } from "./prompt/prompt.module";
import { ReadyValidationModule } from "./ready-validation/ready-validation.module";
import { SopModule } from "./sop/sop.module";
import { StorageModule } from "./storage/storage.module";
import { UploadsModule } from "./uploads/uploads.module";

@Module({
  imports: [
    CommonModule,
    PrismaModule,
    StorageModule,
    UploadsModule,
    OcrModule,
    ReliabilityModule,
    ProjectsModule,
    ProductsModule,
    AnalysisModule,
    ProductObjectModule,
    ContentsModule,
    SopModule,
    DecisionsModule,
    ProjectMemoriesModule,
    MemoryModule,
    KnowledgeModule,
    CompanyBrainModule,
    ReadyValidationModule,
    LlmModule,
    PromptModule,
    ExecutionModule,
    AuthModule,
    AdminSettingsModule,
    AdminModule,
    HealthModule,
    OpsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  /**
   * 모든 요청에 추적 정보를 세운다 (TASK-3601, CTO 정책 3601-②).
   *
   * 경로를 골라 붙이지 않습니다 — 고르는 순간 "여기는 추적이 되고 저기는
   * 안 되는" 상태가 생기고, 그러면 아무도 추적을 믿지 않습니다.
   */
  configure(consumer: MiddlewareConsumer): void {
    // 운영 트래픽 호스트 관측 (TASK-4301, CTO 정책 4301-①) — 요청마다
    // Host 헤더를 메모리에 담기만 하고, 저장은 예약 작업이 한 번에 한다
    consumer
      .apply(RequestContextMiddleware, HostObserverMiddleware)
      .forRoutes("*path");
  }
}
