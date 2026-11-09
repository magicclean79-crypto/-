import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { USER_REQUIREMENT_MAX_LENGTH } from "@acos/shared";
import { ProductProfileController } from "./product-profile.controller";
import { ProductProfileService } from "./product-profile.service";

/**
 * T1-80 — 사용자 요구사항(userRequirement) 입력 검증(빈 입력·과도하게
 * 긴 입력·의미 없는 입력)이 실제로 API 경계에서 걸러지는지 확인한다.
 * `ProductProfileService`는 무겁고(Prisma·LLM·Storage 의존) 이 스펙의
 * 관심사가 아니므로 jest.fn() 목업으로 대체한다 — 검증 로직 자체는
 * `validateUserRequirementText`(packages/shared) 책임이고, 여기서는
 * 컨트롤러가 그 결과를 올바르게 400/통과로 이어 붙이는지만 본다.
 */
describe("ProductProfileController — userRequirement 검증 (T1-80)", () => {
  let app: INestApplication;
  const service = {
    run: jest.fn(async () => ({ id: "pp-1" })),
    updateUserRequirement: jest.fn(async () => ({ id: "pp-1" })),
    generateStory: jest.fn(async () => ({ story: { sections: [] } })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProductProfileController],
      providers: [{ provide: ProductProfileService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const tooLong = "가".repeat(USER_REQUIREMENT_MAX_LENGTH + 1);

  describe("POST /product-profile (run)", () => {
    it("빈/공백 요구사항은 null로 통과한다", async () => {
      await request(app.getHttpServer())
        .post("/product-profile")
        .send({ imageIds: ["img-1"], userRequirement: "   " })
        .expect(201);
      expect(service.run).toHaveBeenCalledWith(["img-1"], undefined, undefined, undefined);
    });

    it("너무 긴 요구사항은 400", async () => {
      await request(app.getHttpServer())
        .post("/product-profile")
        .send({ imageIds: ["img-1"], userRequirement: tooLong })
        .expect(400);
      expect(service.run).not.toHaveBeenCalled();
    });

    it("기호/공백뿐인 요구사항은 400", async () => {
      await request(app.getHttpServer())
        .post("/product-profile")
        .send({ imageIds: ["img-1"], userRequirement: "!!! ... ---" })
        .expect(400);
      expect(service.run).not.toHaveBeenCalled();
    });

    it("같은 글자만 반복된 요구사항은 400", async () => {
      await request(app.getHttpServer())
        .post("/product-profile")
        .send({ imageIds: ["img-1"], userRequirement: "ㅋㅋㅋㅋㅋㅋㅋㅋ" })
        .expect(400);
      expect(service.run).not.toHaveBeenCalled();
    });

    it("정상 요구사항은 trim되어 그대로 전달된다", async () => {
      await request(app.getHttpServer())
        .post("/product-profile")
        .send({ imageIds: ["img-1"], userRequirement: "  배경을 흰색으로  " })
        .expect(201);
      expect(service.run).toHaveBeenCalledWith(["img-1"], undefined, undefined, "배경을 흰색으로");
    });
  });

  describe("PATCH /product-profile/:id/user-requirement", () => {
    it("너무 긴 공용 요구사항은 400", async () => {
      await request(app.getHttpServer())
        .patch("/product-profile/pp-1/user-requirement")
        .send({ userRequirement: tooLong })
        .expect(400);
      expect(service.updateUserRequirement).not.toHaveBeenCalled();
    });

    it("목적별 요구사항 중 하나라도 의미 없으면 400 (부분 저장하지 않는다)", async () => {
      await request(app.getHttpServer())
        .patch("/product-profile/pp-1/user-requirement")
        .send({ userRequirementsByCategory: { HERO: "화이트 배경", DETAIL: "!!!!" } })
        .expect(400);
      expect(service.updateUserRequirement).not.toHaveBeenCalled();
    });

    it("정상 목적별 요구사항은 통과한다", async () => {
      await request(app.getHttpServer())
        .patch("/product-profile/pp-1/user-requirement")
        .send({ userRequirementsByCategory: { HERO: "화이트 배경" } })
        .expect(200);
      expect(service.updateUserRequirement).toHaveBeenCalledWith("pp-1", {
        userRequirement: undefined,
        userRequirementsByCategory: { HERO: "화이트 배경" },
      });
    });
  });

  describe("POST /product-profile/:id/story", () => {
    it("너무 긴 요구사항은 400", async () => {
      await request(app.getHttpServer())
        .post("/product-profile/pp-1/story")
        .send({ userRequirement: tooLong })
        .expect(400);
      expect(service.generateStory).not.toHaveBeenCalled();
    });

    it("빈 body는 저장된 요구사항을 그대로 쓴다(undefined 전달)", async () => {
      await request(app.getHttpServer())
        .post("/product-profile/pp-1/story")
        .send({})
        .expect(201);
      expect(service.generateStory).toHaveBeenCalledWith("pp-1", undefined);
    });
  });
});
