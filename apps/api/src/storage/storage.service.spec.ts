import { StorageService } from "./storage.service";

/**
 * 저장소 프로비저닝 경계 검증. (TASK-2201, CTO 결정 2101-④)
 *
 * 판정 로직은 core에서 검증하므로 여기서는 **어댑터가 그 판정을 지키는지**를
 * 본다: 운영에서 버킷을 만들지 않는가 / 정책을 걸지 않는가 / 없을 때 누가
 * 무엇을 해야 하는지 말하는가.
 */
describe("StorageService 프로비저닝 (TASK-2201)", () => {
  const original = { ...process.env };

  interface ClientCalls {
    made: string[];
    policies: string[];
  }

  /** minio 클라이언트를 대신한다 — 실제 호출 대신 기록만 남긴다 */
  function stubClient(service: StorageService, exists: boolean): ClientCalls {
    const calls: ClientCalls = { made: [], policies: [] };
    Object.defineProperty(service, "client", {
      value: {
        bucketExists: async () => exists,
        makeBucket: async (bucket: string) => {
          calls.made.push(bucket);
        },
        setBucketPolicy: async (bucket: string) => {
          calls.policies.push(bucket);
        },
        putObject: async () => undefined,
      },
      configurable: true,
    });
    return calls;
  }

  afterEach(() => {
    process.env = { ...original };
  });

  it("개발에서는 버킷을 만들고 공개 읽기 정책을 건다", async () => {
    delete process.env.NODE_ENV;
    const service = new StorageService();
    const calls = stubClient(service, false);

    await service.putObject("a.png", Buffer.from("x"), "image/png");

    expect(calls.made).toContain(service.bucket);
    expect(calls.policies).toContain(service.bucket);
  });

  it("운영에서는 버킷을 만들지 않는다 (CTO 결정 2101-④)", async () => {
    process.env.NODE_ENV = "production";
    const service = new StorageService();
    const calls = stubClient(service, false);

    // 운영에서 "MinIO가 실행 중인지 확인하세요"는 거짓 안내다 —
    // 진짜 원인(버킷 미준비)이 그대로 올라와야 한다
    await expect(
      service.putObject("a.png", Buffer.from("x"), "image/png"),
    ).rejects.toThrow(/애플리케이션이 버킷을 만들지 않습니다/);
    expect(calls.made).toEqual([]);
    expect(calls.policies).toEqual([]);
  });

  it("운영에서는 버킷이 있어도 정책을 덮어쓰지 않는다", async () => {
    // 운영자가 콘솔에서 조인 권한이 재기동마다 풀리면 안 된다
    process.env.NODE_ENV = "production";
    const service = new StorageService();
    const calls = stubClient(service, true);

    await service.putObject("a.png", Buffer.from("x"), "image/png");
    expect(calls.policies).toEqual([]);
  });

  it("운영에서 버킷이 없으면 누가 무엇을 해야 하는지 말한다", async () => {
    process.env.NODE_ENV = "production";
    const service = new StorageService();
    stubClient(service, false);

    await expect(service.check()).rejects.toThrow(
      /애플리케이션이 버킷을 만들지 않습니다/,
    );
  });

  it("백업 버킷도 운영에서는 만들지 않는다", async () => {
    process.env.NODE_ENV = "production";
    const service = new StorageService();
    const calls = stubClient(service, false);

    await expect(
      service.putBackupObject("backups/a.dump", Buffer.from("x")),
    ).rejects.toThrow(/운영 담당자/);
    expect(calls.made).toEqual([]);
  });

  it("백업 버킷에는 어느 환경에서도 공개 정책을 걸지 않는다", async () => {
    delete process.env.NODE_ENV;
    const service = new StorageService();
    const calls = stubClient(service, false);

    await service.putBackupObject("backups/a.dump", Buffer.from("x"));
    expect(calls.made).toContain(service.backupBucket);
    // 덤프가 공개되면 데이터베이스 전체가 공개되는 것과 같다
    expect(calls.policies).toEqual([]);
  });
});

describe("StorageService 개발 안내 (TASK-2201)", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it("개발에서는 여전히 MinIO 안내를 준다 — 그때는 그것이 맞는 원인이다", async () => {
    delete process.env.NODE_ENV;
    const service = new StorageService();
    Object.defineProperty(service, "client", {
      value: {
        bucketExists: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
      configurable: true,
    });

    await expect(
      service.putObject("a.png", Buffer.from("x"), "image/png"),
    ).rejects.toThrow(/MinIO가 실행 중인지/);
  });
});
