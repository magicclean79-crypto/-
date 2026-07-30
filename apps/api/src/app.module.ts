import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AppController } from "./app.controller";
import { CommonModule } from "./common/common.module";
import { RequestContextMiddleware } from "./common/request-context.service";
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
    consumer.apply(RequestContextMiddleware).forRoutes("*path");
  }
}
