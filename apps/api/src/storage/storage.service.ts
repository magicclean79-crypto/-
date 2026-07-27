import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Client } from "minio";

const DEFAULT_ENDPOINT = "http://localhost:9000";

function publicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Client;
  private readonly publicBase: string;
  private bucketReady = false;

  readonly bucket = process.env.S3_BUCKET ?? "acos";

  constructor() {
    const endpoint = new URL(process.env.S3_ENDPOINT ?? DEFAULT_ENDPOINT);
    const useSSL = endpoint.protocol === "https:";

    this.client = new Client({
      endPoint: endpoint.hostname,
      port: endpoint.port ? Number(endpoint.port) : useSSL ? 443 : 80,
      useSSL,
      accessKey: process.env.S3_ACCESS_KEY ?? "minioadmin",
      secretKey: process.env.S3_SECRET_KEY ?? "minioadmin",
    });

    this.publicBase = (
      process.env.S3_PUBLIC_URL ?? endpoint.origin
    ).replace(/\/+$/, "");
  }

  async onModuleInit(): Promise<void> {
    // 스토리지가 꺼져 있어도 API 기동은 막지 않는다.
    try {
      await this.ensureBucket();
      this.logger.log(`Object storage ready (bucket: ${this.bucket})`);
    } catch {
      this.logger.warn(
        "Object storage is not reachable. Run `pnpm docker:up` to start MinIO.",
      );
    }
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) {
      return;
    }
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
    try {
      await this.client.setBucketPolicy(
        this.bucket,
        publicReadPolicy(this.bucket),
      );
    } catch {
      // 버킷 정책을 지원하지 않는 스토리지(로컬 목업 등)에서는 건너뛴다.
      this.logger.warn("Could not apply public-read bucket policy.");
    }
    this.bucketReady = true;
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${this.bucket}/${key}`;
  }

  async putObject(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    try {
      await this.ensureBucket();
      await this.client.putObject(this.bucket, key, buffer, buffer.length, {
        "Content-Type": mimeType,
      });
      return this.publicUrl(key);
    } catch (error) {
      this.logger.error(`Failed to store object "${key}"`, error as Error);
      throw new ServiceUnavailableException(
        "스토리지에 연결할 수 없습니다. MinIO가 실행 중인지 확인해 주세요. (pnpm docker:up)",
      );
    }
  }

  async removeObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    try {
      await this.client.removeObjects(this.bucket, keys);
    } catch {
      this.logger.warn(`Failed to clean up objects: ${keys.join(", ")}`);
    }
  }
}
