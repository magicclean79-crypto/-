import { Logger, Module, type OnModuleDestroy } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { MockOcrProvider, type OcrProvider } from "@acos/core";
import {
  DEV_ONLY_OCR_PROVIDERS,
  PRODUCTION_OCR_PROVIDER,
} from "@acos/core";
import { LlmModule } from "../llm/llm.module";
import { PricingModule } from "../pricing/pricing.module";
import { OCR_PROVIDER } from "./ocr.constants";
import { OcrController } from "./ocr.controller";
import { OcrService } from "./ocr.service";
import { PrismaOcrRunStore } from "./prisma-ocr-run.store";
import { GoogleVisionOcrProvider } from "./providers/google-vision.provider";
import { TesseractOcrProvider } from "./providers/tesseract.provider";

/** 구현된 엔진 이름 — 이 목록에 없는 값은 오타이거나 미구현이다 */
export const KNOWN_OCR_PROVIDERS = [
  "mock",
  ...DEV_ONLY_OCR_PROVIDERS,
  PRODUCTION_OCR_PROVIDER,
];

/**
 * `OCR_PROVIDER` 환경 변수로 Provider를 선택한다. (기본: mock)
 *
 * **알 수 없는 값을 조용히 mock으로 대체하지 않습니다** (TASK-2901).
 * 그전에는 `OCR_PROVIDER=google`(오타·미구현) 같은 값이 경고 한 줄만 남기고
 * **가짜 OCR로 운영을 돌렸습니다.** 그러면 이미지에서 읽지도 않은 텍스트로
 * 상품이 조립되고, 그 상품이 검수를 통과합니다 — 이 프로젝트에서 가장 위험한
 * 조용한 실패입니다.
 *
 * 그래서 운영에서는 **기동을 차단**합니다(Fail Fast). 개발에서는 지금처럼
 * 경고 후 mock으로 갑니다 — 개발자의 로컬을 못 뜨게 만들 이유는 없고,
 * 그때는 mock이 정상 기본값이기 때문입니다.
 */
export function createOcrProvider(
  env: Record<string, string | undefined> = process.env,
): OcrProvider {
  const logger = new Logger("OcrModule");
  const name = (env.OCR_PROVIDER ?? "mock").trim().toLowerCase();
  const production = (env.NODE_ENV ?? "").trim().toLowerCase() === "production";

  if (!KNOWN_OCR_PROVIDERS.includes(name)) {
    const message = `알 수 없는 OCR_PROVIDER "${name}" — 구현된 엔진은 ${KNOWN_OCR_PROVIDERS.join(", ")}입니다.`;
    if (production) {
      // 가짜로 돌아가는 것보다 뜨지 않는 편이 안전하다
      throw new Error(
        `${message} 운영에서는 mock으로 대체하지 않고 기동을 중단합니다 — ` +
          "가짜 OCR로 조립된 상품은 사실이 아닙니다.",
      );
    }
    logger.warn(`${message} 개발 환경이므로 mock으로 대체합니다.`);
    return new MockOcrProvider();
  }

  if (name === PRODUCTION_OCR_PROVIDER) {
    // 키가 없으면 생성 시점에 실패한다 — 첫 호출까지 기다리면 그때는
    // 이미 이미지가 올라가 있고, 사용자는 OCR이 되는 줄 안다
    return new GoogleVisionOcrProvider({
      apiKey: env.GOOGLE_VISION_API_KEY ?? "",
      endpoint: env.GOOGLE_VISION_ENDPOINT,
      languageHints: (env.OCR_LANGUAGE_HINTS ?? "ko,en")
        .split(",")
        .map((hint) => hint.trim())
        .filter(Boolean),
    });
  }

  if (DEV_ONLY_OCR_PROVIDERS.includes(name)) {
    // 개발용 선택 엔진 (CTO 결정 2401-⑤) — 운영에서 돌아도 막지는 않지만
    // 운영 표준이 아니라는 사실은 남긴다
    if (production) {
      logger.warn(
        `OCR_PROVIDER=${name}은 개발용 선택 엔진입니다 (CTO 결정 2401-⑤) — ` +
          `운영 표준은 ${PRODUCTION_OCR_PROVIDER}입니다.`,
      );
    }
    return new TesseractOcrProvider();
  }

  if (production) {
    // 막지는 않는다(경보와 차단은 다르다) — 다만 조용히 지나가지 않는다
    logger.warn(
      "운영 환경인데 OCR_PROVIDER가 mock입니다 — 이미지에서 글자를 읽지 않고 " +
        "가짜 텍스트를 만듭니다. /ops/providers가 이 사실을 보고합니다.",
    );
  }
  return new MockOcrProvider();
}

@Module({
  // AI 비용 예산을 LLM과 공유한다 (TASK-3001, CTO 결정 2901-④)
  // 단가는 승인·적용된 가격표에서 온다 (TASK-3101, CTO 정책 3101-①)
  imports: [LlmModule, PricingModule],
  controllers: [OcrController],
  providers: [
    OcrService,
    PrismaOcrRunStore,
    {
      provide: OCR_PROVIDER,
      useFactory: () => createOcrProvider(),
    },
  ],
  exports: [OcrService],
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
