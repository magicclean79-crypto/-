import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AnalysisModule } from "./analysis/analysis.module";
import { ContentsModule } from "./contents/contents.module";
import { DecisionsModule } from "./decisions/decisions.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { MemoriesModule } from "./memories/memories.module";
import { OcrModule } from "./ocr/ocr.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProductObjectModule } from "./product-object/product-object.module";
import { ProductsModule } from "./products/products.module";
import { ProjectsModule } from "./projects/projects.module";
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
    MemoriesModule,
    KnowledgeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
