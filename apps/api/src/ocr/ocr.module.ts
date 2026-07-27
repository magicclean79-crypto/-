import { Logger, Module, type OnModuleDestroy } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { MockOcrProvider, type OcrProvider } from "@acos/core";
import { OCR_PROVIDER } from "./ocr.constants";
import { OcrController } from "./ocr.controller";
import { OcrService } from "./ocr.service";
import { PrismaOcrRunStore } from "./prisma-ocr-run.store";
import { TesseractOcrProvider } from "./providers/tesseract.provider";

/**
 * OCR_PROVIDER 환경 변수로 Provider를 선택한다. (기본: mock)
 *
 * 새 엔진(Google Vision, Azure Vision, AWS Textract, CLOVA OCR 등)은
 * @acos/core의 OcrProvider를 구현한 뒤 여기에 case 하나만 추가하면 된다.
 * 자세한 방법: docs/architecture/ocr.md
 */
function createOcrProvider(): OcrProvider {
  const name = (process.env.OCR_PROVIDER ?? "mock").toLowerCase();
  switch (name) {
    case "mock":
      return new MockOcrProvider();
    case "tesseract":
      return new TesseractOcrProvider();
    default:
      new Logger("OcrModule").warn(
        `알 수 없는 OCR_PROVIDER "${name}" — mock으로 대체합니다.`,
      );
      return new MockOcrProvider();
  }
}

@Module({
  controllers: [OcrController],
  providers: [
    OcrService,
    PrismaOcrRunStore,
    {
      provide: OCR_PROVIDER,
      useFactory: createOcrProvider,
    },
  ],
})
export class OcrModule implements OnModuleDestroy {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleDestroy(): Promise<void> {
    const provider = this.moduleRef.get<OcrProvider>(OCR_PROVIDER, {
      strict: false,
    });
    if (provider instanceof TesseractOcrProvider) {
      await provider.destroy();
    }
  }
}
