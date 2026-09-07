import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AuthService } from "../auth/auth.service";
import { WriteProtectionGuard } from "../auth/write-protection.guard";
import { ImageGenController } from "./image-gen.controller";
import { ImageGenService } from "./image-gen.service";

/**
 * Image Studio 무로그인 접근 (T1-90). `/image-gen/*`는 `/image-studio`
 * 화면 전용 API이고(다른 화면은 호출하지 않음, 조사로 확인), 로그인 없이
 * 바로 쓸 수 있어야 한다는 정책에 따라 전 엔드포인트를 `@Public()`으로
 * 표시했다 — 전역 `WriteProtectionGuard`(기본 EDITOR 이상 요구)를 우회하는
 * 것이 실제로 이 컨트롤러에서만 동작하는지 여기서 고정한다.
 */
describe("ImageGenController — 로그인 없이 접근 가능 (T1-90)", () => {
  let app: INestApplication;

  const image = { id: "img-1", url: "http://localhost:9000/acos/img-1" };

  const service = {
    removeBackground: async () => image,
    generateBackground: async () => image,
    composite: async () => image,
    generateHero: async () => ({
      original: image,
      backgroundRemoved: image,
      backgroundGenerated: image,
      composited: image,
    }),
    generateUsageShots: async () => ({ shots: [image] }),
    generateImageCandidates: async () => ({ results: [image] }),
    listCandidates: async () => [image],
    selectImage: async () => image,
    getImagesByIds: async () => [image],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ImageGenController],
      providers: [
        { provide: ImageGenService, useValue: service },
        // 토큰이 전혀 없어도 통과해야 하므로 AuthService는 항상 미인증(null)만
        // 반환한다 — 그런데도 아래 요청들이 401이 아니어야 @Public()이
        // 실제로 걸려 있다는 증거다.
        { provide: AuthService, useValue: { validateToken: async () => null } },
        { provide: APP_GUARD, useClass: WriteProtectionGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const noAuth = () => request(app.getHttpServer());

  it("POST /image-gen/remove-background — Authorization 헤더 없이 200", async () => {
    await noAuth()
      .post("/image-gen/remove-background")
      .send({ imageId: "img-1" })
      .expect(201);
  });

  it("POST /image-gen/generate-background — Authorization 헤더 없이 200", async () => {
    await noAuth()
      .post("/image-gen/generate-background")
      .send({ sourceImageId: "img-1" })
      .expect(201);
  });

  it("POST /image-gen/composite — Authorization 헤더 없이 200", async () => {
    await noAuth()
      .post("/image-gen/composite")
      .send({ productImageId: "img-1", backgroundImageId: "img-2" })
      .expect(201);
  });

  it("POST /image-gen/hero — Authorization 헤더 없이 200", async () => {
    await noAuth().post("/image-gen/hero").send({ imageId: "img-1" }).expect(201);
  });

  it("POST /image-gen/usage-shots — Authorization 헤더 없이 200", async () => {
    await noAuth().post("/image-gen/usage-shots").send({ imageId: "img-1" }).expect(201);
  });

  it("POST /image-gen/candidates — Authorization 헤더 없이 200", async () => {
    await noAuth()
      .post("/image-gen/candidates")
      .send({ imageId: "img-1", category: "HERO" })
      .expect(201);
  });

  it("POST /image-gen/select — Authorization 헤더 없이 200", async () => {
    await noAuth().post("/image-gen/select").send({ imageId: "img-1" }).expect(201);
  });

  it("GET /image-gen/candidates — 원래부터 비보호(조회) — Authorization 헤더 없이 200", async () => {
    await noAuth()
      .get("/image-gen/candidates")
      .query({ sourceImageId: "img-1", category: "HERO" })
      .expect(200);
  });

  it("GET /image-gen/images — 참조 사진 photoType 조회(T1-99) — Authorization 헤더 없이 200", async () => {
    await noAuth().get("/image-gen/images").query({ ids: "img-1,img-2" }).expect(200);
  });

  it("GET /image-gen/images — ids 없이 요청하면 400", async () => {
    await noAuth().get("/image-gen/images").expect(400);
  });
});
