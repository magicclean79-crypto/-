import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Client } from "minio";
import type { ProtectionState } from "@acos/core";

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

  /**
   * 백업 전용 버킷 (TASK-1801, CTO 결정 1701-②).
   *
   * 이미지와 **다른 버킷**이 기본이다 — 같은 버킷에 두면 그 버킷이 사라질 때
   * 이미지와 백업이 함께 사라져, 원격 복제의 목적을 절반만 달성한다.
   */
  readonly backupBucket =
    process.env.BACKUP_BUCKET?.trim() || `${process.env.S3_BUCKET ?? "acos"}-backups`;

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

  /**
   * 저장소 접근 점검 (TASK-1202) — 버킷 존재 확인.
   * 실패는 예외로 올린다 (호출자가 사유를 그대로 보고한다).
   */
  async check(): Promise<string> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      throw new Error(`버킷을 찾을 수 없습니다: ${this.bucket}`);
    }
    return `버킷 접근 정상 (${this.bucket})`;
  }

  /**
   * 버킷 보호 상태 (TASK-1701, CTO 결정 1601-④).
   *
   * **애플리케이션은 이미지를 백업하지 않는다** — 저장소 제공자의 버전 관리·
   * 복제에 의존한다. 그러니 최소한 그 정책이 켜져 있는지는 보여야 한다.
   *
   * 저장소가 조회를 지원하지 않으면(로컬 목업 등) **`unknown`으로 남긴다** —
   * 확인하지 못한 것을 "꺼져 있음"이라고 단정하면 그것도 거짓이다.
   */
  async describeProtection(
    bucket = this.bucket,
  ): Promise<{
    versioning: ProtectionState;
    replication: ProtectionState;
  }> {
    const [versioning, replication] = await Promise.all([
      this.readVersioning(bucket),
      this.readReplication(bucket),
    ]);
    return { versioning, replication };
  }

  private async readVersioning(bucket: string): Promise<ProtectionState> {
    try {
      const config = (await this.client.getBucketVersioning(bucket)) as
        | { Status?: string }
        | undefined;
      const status = config?.Status?.trim().toLowerCase();
      if (!status) {
        // 응답은 왔지만 상태가 비어 있으면 꺼진 것으로 본다(S3 규약)
        return "disabled";
      }
      return status === "enabled" ? "enabled" : "disabled";
    } catch {
      return "unknown";
    }
  }

  private async readReplication(bucket: string): Promise<ProtectionState> {
    try {
      const config = (await this.client.getBucketReplication(bucket)) as
        | { Rule?: unknown }
        | undefined;
      const rules = config?.Rule;
      const list = Array.isArray(rules) ? rules : rules ? [rules] : [];
      return list.length > 0 ? "enabled" : "disabled";
    } catch (error) {
      // 규칙이 없을 때 오류로 답하는 구현이 있다 — 그건 "없음"이지 "모름"이 아니다
      const message =
        error instanceof Error ? error.message.toLowerCase() : String(error);
      return message.includes("replicationconfigurationnotfound") ||
        message.includes("not found") ||
        message.includes("no replication")
        ? "disabled"
        : "unknown";
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

  /**
   * 백업 전용 버킷에 올린다 (CTO 결정 1701-②).
   *
   * 이미지 버킷과 정책이 다르다 — **공개 읽기 정책을 걸지 않는다.**
   * 백업 덤프가 공개되면 데이터베이스 전체가 공개되는 것과 같다.
   */
  async putBackupObject(key: string, buffer: Buffer): Promise<string> {
    await this.ensureBackupBucket();
    await this.client.putObject(
      this.backupBucket,
      key,
      buffer,
      buffer.length,
      { "Content-Type": "application/octet-stream" },
    );
    return `${this.backupBucket}/${key}`;
  }

  /** 백업 버킷 보호 상태 — 이미지 버킷과 따로 본다 */
  async describeBackupProtection(): Promise<{
    versioning: ProtectionState;
    replication: ProtectionState;
  }> {
    return this.describeProtection(this.backupBucket);
  }

  private backupBucketReady = false;

  private async ensureBackupBucket(): Promise<void> {
    if (this.backupBucketReady) {
      return;
    }
    if (!(await this.client.bucketExists(this.backupBucket))) {
      await this.client.makeBucket(this.backupBucket);
    }
    // 공개 정책을 걸지 않는다 — 백업은 공개 대상이 아니다
    this.backupBucketReady = true;
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

  async getObject(key: string): Promise<Buffer> {
    await this.ensureBucket();
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
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
