import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Logger } from "@nestjs/common";
import { createWorker, type Worker } from "tesseract.js";
import type { OcrProvider, OcrRecognition } from "../ocr-provider.interface";

/**
 * tesseract.js 기반 OCR Provider.
 *
 * 언어 데이터는 @tesseract.js-data/* 패키지에서 로드하므로
 * 런타임 네트워크 없이 완전히 오프라인으로 동작한다.
 * 언어는 OCR_LANGS 환경 변수로 지정한다. (기본: eng+kor)
 */
export class TesseractOcrProvider implements OcrProvider {
  readonly name = "tesseract";

  private readonly logger = new Logger(TesseractOcrProvider.name);
  private readonly langs: string[];
  private workerPromise: Promise<Worker> | null = null;

  constructor() {
    this.langs = (process.env.OCR_LANGS ?? "eng+kor")
      .split("+")
      .map((lang) => lang.trim())
      .filter(Boolean);
  }

  /** @tesseract.js-data 패키지의 traineddata를 공용 디렉터리로 모은다. */
  private prepareLangDir(): string {
    const langDir = join(tmpdir(), "acos-tessdata");
    mkdirSync(langDir, { recursive: true });

    for (const lang of this.langs) {
      const target = join(langDir, `${lang}.traineddata.gz`);
      if (existsSync(target)) {
        continue;
      }
      const pkgRoot = dirname(
        require.resolve(`@tesseract.js-data/${lang}/package.json`),
      );
      const source = this.findTrainedData(pkgRoot, lang);
      if (!source) {
        throw new Error(
          `@tesseract.js-data/${lang} 패키지에서 traineddata를 찾을 수 없습니다.`,
        );
      }
      copyFileSync(source, target);
    }
    return langDir;
  }

  private findTrainedData(root: string, lang: string): string | null {
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.name === `${lang}.traineddata.gz`) {
          return full;
        }
      }
    }
    return null;
  }

  private getWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      const langDir = this.prepareLangDir();
      this.logger.log(
        `Initializing tesseract worker (langs: ${this.langs.join("+")})`,
      );
      this.workerPromise = createWorker(this.langs, undefined, {
        langPath: langDir,
        cachePath: langDir,
        gzip: true,
        // 필수: tesseract.js는 작업 실패 시 promise를 reject한 뒤,
        // errorHandler가 없으면 전역으로 다시 throw하여 프로세스를 죽인다.
        // 핸들러를 제공해 reject(→ OcrService의 재시도)로만 전달되게 한다.
        errorHandler: (error: unknown) => {
          this.logger.warn(
            `tesseract worker error: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      });
      // 초기화 실패 시 다음 호출에서 다시 시도할 수 있게 리셋한다.
      this.workerPromise.catch(() => {
        this.workerPromise = null;
      });
    }
    return this.workerPromise;
  }

  async recognize(image: Buffer): Promise<OcrRecognition> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(image);

    return {
      text: data.text.trim(),
      confidence: Math.max(0, Math.min(1, data.confidence / 100)),
      raw: JSON.parse(
        JSON.stringify({
          engine: "tesseract.js",
          langs: this.langs.join("+"),
          data,
        }),
      ),
    };
  }

  async destroy(): Promise<void> {
    if (this.workerPromise) {
      const worker = await this.workerPromise.catch(() => null);
      await worker?.terminate();
      this.workerPromise = null;
    }
  }
}
