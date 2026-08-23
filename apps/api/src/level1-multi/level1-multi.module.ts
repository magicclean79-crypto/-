import { Module } from "@nestjs/common";
import { OcrModule } from "../ocr/ocr.module";
import { Level1AssetOcrService } from "./level1-asset-ocr.service";
import { Level1AssetOcrStore } from "./level1-asset-ocr.store";
import { Level1MultiController } from "./level1-multi.controller";
import { Level1MultiService } from "./level1-multi.service";

/**
 * LEVEL 2 다중 상세페이지 생성 모듈 (T1-191, OCR 강화는 T1-196).
 * PrismaModule·StorageModule은 `@Global()`이라 별도 import 없이 주입된다.
 * `Level1Module`(T1-188)·`Level1GenerateModule`(T1-189)은 import하지
 * 않는다 — Prisma로 같은 테이블을 직접 읽어 재사용하고, 그 모듈 파일은
 * 건드리지 않는다.
 *
 * `OcrModule`은 import한다(T1-196) — "OCR은 AI가 아닌 별도 OCR provider가
 * 이미 있으면 그것을 우선 사용한다"는 요청 사양에 따라, 이 프로젝트가
 * 이미 쓰는 실제 OCR provider(`OCR_PROVIDER` 환경변수로 선택, 운영은
 * google-vision)를 새로 만들지 않고 그대로 재사용한다.
 */
@Module({
  imports: [OcrModule],
  controllers: [Level1MultiController],
  providers: [Level1MultiService, Level1AssetOcrService, Level1AssetOcrStore],
})
export class Level1MultiModule {}
