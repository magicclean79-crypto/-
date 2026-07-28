import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AnalysisModule } from "./analysis/analysis.module";
import { AdminSettingsModule } from "./admin/admin-settings.module";
import { AdminModule } from "./admin/admin.module";
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
