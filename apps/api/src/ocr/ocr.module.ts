import { Logger, Module, type OnModuleDestroy } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { OCR_PROVIDER, type OcrProvider } from "./ocr-provider.interface";
import { OcrController } from "./ocr.controller";
import { OcrService } from "./ocr.service";
import { StubOcrProvider } from "./providers/stub.provider";
import { TesseractOcrProvider } from "./providers/tesseract.provider";

/**
 * OCR_PROVIDER 환경 변수로 Provider를 선택한다.
 * 새 Provider는 여기에 case를 추가하면 된다.
 */
function createOcrProvider(): OcrProvider {
  const name = (process.env.OCR_PROVIDER ?? "tesseract").toLowerCase();
  switch (name) {
    case "stub":
      return new StubOcrProvider();
    case "tesseract":
      return new TesseractOcrProvider();
    default:
      new Logger("OcrModule").warn(
        `알 수 없는 OCR_PROVIDER "${name}" — tesseract로 대체합니다.`,
      );
      return new TesseractOcrProvider();
  }
}

@Module({
  controllers: [OcrController],
  providers: [
    OcrService,
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
