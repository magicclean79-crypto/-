import { Module } from "@nestjs/common";
import { ContentsModule } from "../contents/contents.module";
import { OcrModule } from "../ocr/ocr.module";
import { ProductObjectModule } from "../product-object/product-object.module";
import { SopController } from "./sop.controller";
import { SopService } from "./sop.service";

/**
 * SOP 실행 모듈 (TASK-0305).
 * 기존 모듈의 서비스(OCR/Product Object/Contents)를 단계 실행자로 재사용한다.
 */
@Module({
  imports: [OcrModule, ProductObjectModule, ContentsModule],
  controllers: [SopController],
  providers: [SopService],
})
export class SopModule {}
