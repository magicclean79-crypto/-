import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { OcrModule } from "./ocr/ocr.module";
import { PrismaModule } from "./prisma/prisma.module";
import { StorageModule } from "./storage/storage.module";
import { UploadsModule } from "./uploads/uploads.module";

@Module({
  imports: [PrismaModule, StorageModule, UploadsModule, OcrModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
