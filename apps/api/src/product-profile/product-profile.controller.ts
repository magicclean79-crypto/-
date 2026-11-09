import { BadRequestException, Body, Controller, Get, Header, Param, Patch, Post, Query } from "@nestjs/common";
import { IMAGE_CATEGORIES, validateUserRequirementText } from "@acos/shared";
import type {
  GenerateProductStoryRequest,
  ProductProfileDto,
  ProductProfileFinalPageDto,
  ProductStoryResultDto,
  RunProductProfileRequest,
  UpdateProductProfileUserRequirementRequest,
} from "@acos/shared";
import { PublicInDev } from "../auth/write-protection.guard";
import { ProductProfileService } from "./product-profile.service";

/**
 * 사용자 요구사항 자유 텍스트를 검증하고 저장할 값을 돌려준다 (T1-80).
 * 빈 입력·과도하게 긴 입력·의미 없는 입력을 여기서 걸러낸다 — 통과하면
 * trim된 문자열 또는 null(요구사항 없음), 실패하면 400을 던진다.
 */
function validateOrThrow(input: string | null | undefined, label: string): string | null {
  const result = validateUserRequirementText(input);
  if (!result.ok) {
    throw new BadRequestException(`${label}: ${result.reason}`);
  }
  return result.value;
}

/**
 * Product Detail Engine V1. (TASK-5601, Sprint 35 — CTO 지시 "Sprint 35
 * Phase 1")
 *
 * STEP 1(업로드) `POST /uploads/images`, STEP 2(OCR) `POST
 * /images/:imageId/ocr`는 기존 라우트를 그대로 쓴다. 이 컨트롤러는
 * STEP 3+4(이미지 특징 분석 → Product Profile 통합)만 노출한다.
 *
 * 쓰기 엔드포인트 3개(`run`·`updateUserRequirement`·`generateStory`)는
 * `/image-studio` 화면이 제품 분석·요구사항 저장·Product Story 생성에
 * 직접 호출한다(T1-110 조사로 확인). `/image-gen/*`(T1-90)와 같은 이유로
 * 로그인 없이 바로 쓸 수 있어야 하지만, 이 컨트롤러는 실 OpenAI 호출
 * (과금)로 이어지는 API라 `@Public()` 대신 `@PublicInDev()`를 쓴다 —
 * 운영/스테이징(NODE_ENV)에서는 그대로 인증을 요구해, 인터넷에 노출됐을
 * 때 과금 API가 함께 공개되지 않게 한다.
 */
@Controller("product-profile")
export class ProductProfileController {
  constructor(private readonly service: ProductProfileService) {}

  /** STEP 3+4 실행 — 실 LLM 호출 2건(이미지 분석 + 통합), 과금 발생 */
  @Post()
  @PublicInDev()
  async run(
    @Body() body: RunProductProfileRequest,
  ): Promise<ProductProfileDto> {
    if (!Array.isArray(body?.imageIds)) {
      throw new BadRequestException("imageIds는 문자열 배열이어야 합니다.");
    }
    if (body.userRequirement !== undefined && typeof body.userRequirement !== "string") {
      throw new BadRequestException("userRequirement는 문자열이어야 합니다.");
    }
    const userRequirement =
      body.userRequirement === undefined
        ? undefined
        : (validateOrThrow(body.userRequirement, "userRequirement") ?? undefined);
    return this.service.run(body.imageIds, body.projectId, body.templateKey, userRequirement);
  }

  /** 실행 결과 조회 */
  @Get(":id")
  async get(@Param("id") id: string): Promise<ProductProfileDto> {
    return this.service.get(id);
  }

  /**
   * 사용자 요구사항만 저장한다 (T1-92, 목적별 입력은 T1-99) — 실행을 다시
   * 돌리지 않는다(비용 없음). Gemini 이미지 생성은 이 값을 바로 다음
   * 생성부터 읽어 쓴다. 상세페이지 카피에 반영하려면 `POST
   * /product-profile`을 같은 imageIds로 다시 호출해야 한다(실 LLM 호출
   * 발생) — `userRequirementsByCategory`(목적별)는 카피 생성에는 쓰이지
   * 않는다.
   *
   * `userRequirement`·`userRequirementsByCategory` 중 최소 하나는 있어야
   * 한다 — 둘 다 없으면 아무것도 바뀌지 않는 호출이라 실수로 보인다.
   */
  @Patch(":id/user-requirement")
  @PublicInDev()
  async updateUserRequirement(
    @Param("id") id: string,
    @Body() body: UpdateProductProfileUserRequirementRequest,
  ): Promise<ProductProfileDto> {
    if (
      body?.userRequirement !== undefined &&
      body.userRequirement !== null &&
      typeof body.userRequirement !== "string"
    ) {
      throw new BadRequestException("userRequirement는 문자열 또는 null이어야 합니다.");
    }
    let validatedByCategory: Partial<Record<(typeof IMAGE_CATEGORIES)[number], string | null>> | undefined;
    if (body?.userRequirementsByCategory !== undefined) {
      if (
        typeof body.userRequirementsByCategory !== "object" ||
        body.userRequirementsByCategory === null ||
        Array.isArray(body.userRequirementsByCategory)
      ) {
        throw new BadRequestException("userRequirementsByCategory는 객체여야 합니다.");
      }
      validatedByCategory = {};
      for (const [category, value] of Object.entries(body.userRequirementsByCategory)) {
        if (!IMAGE_CATEGORIES.includes(category as (typeof IMAGE_CATEGORIES)[number])) {
          throw new BadRequestException(
            `userRequirementsByCategory의 키는 다음 중 하나여야 합니다: ${IMAGE_CATEGORIES.join(", ")} (받은 값: ${category})`,
          );
        }
        if (value !== null && typeof value !== "string") {
          throw new BadRequestException(
            `userRequirementsByCategory.${category}는 문자열 또는 null이어야 합니다.`,
          );
        }
        validatedByCategory[category as (typeof IMAGE_CATEGORIES)[number]] = validateOrThrow(
          value,
          `userRequirementsByCategory.${category}`,
        );
      }
    }
    if (body?.userRequirement === undefined && body?.userRequirementsByCategory === undefined) {
      throw new BadRequestException(
        "userRequirement 또는 userRequirementsByCategory 중 하나는 있어야 합니다.",
      );
    }
    const validatedUserRequirement =
      body.userRequirement === undefined ? undefined : validateOrThrow(body.userRequirement, "userRequirement");
    return this.service.updateUserRequirement(id, {
      userRequirement: validatedUserRequirement,
      userRequirementsByCategory: validatedByCategory,
    });
  }

  /** STEP 5 결과 — 완전한 HTML 문서(미리보기·다운로드용). 나중에 다시 열어볼 수 있다 */
  @Get(":id/html")
  @Header("Content-Type", "text/html; charset=utf-8")
  async getHtml(@Param("id") id: string): Promise<string> {
    return this.service.getHtmlDocument(id);
  }

  /**
   * 최종 상세페이지 (T1-75, T1-131부터 캐노니컬 파이프라인 우선) —
   * `POST /:id/story`가 최소 1회 성공해 저장돼 있으면 그 결과(Story +
   * Design Plan + 실제 제품 사진/Gemini 생성 비주얼)를 그대로 돌려준다
   * (`source: "story"`, 추가 LLM 호출 없음). 아직 Story가 한 번도
   * 생성되지 않았으면, 사람이 카테고리별로 선택(검증)해 둔 이미지가
   * 있는 경우 레거시 템플릿으로 다시 조립하고(`source: "legacy"`),
   * 그것도 없으면 STEP 5 결과를 그대로 돌려준다. 레거시 템플릿은 더 이상
   * 기본값이 아니라 Story가 없을 때만 쓰는 fallback이다.
   */
  @Get(":id/final")
  async getFinal(@Param("id") id: string): Promise<ProductProfileFinalPageDto> {
    return this.service.getFinalPage(id);
  }

  /** 최종 상세페이지 — 완전한 HTML 문서(미리보기·다운로드용). `/final`과 동일한 우선순위(캐노니컬 Story 우선) */
  @Get(":id/final-html")
  @Header("Content-Type", "text/html; charset=utf-8")
  async getFinalHtml(@Param("id") id: string): Promise<string> {
    return this.service.getFinalHtmlDocument(id);
  }

  /**
   * Product Story 생성 (T1-94, T1-131부터 최종 상세페이지의 캐노니컬
   * 생성기) — 상세페이지를 "제품의 스토리를 만드는 것"으로 재정의한
   * 정식 단계. Image Studio에서 이미 선택(검증)해 둔 실제 제품 이미지가
   * 있어야 한다(없으면 400). 실 LLM 호출 1건, 과금 발생 — 다시 만들고
   * 싶으면 다시 호출해야 하고 그때마다 다시 과금된다. 이번 호출 결과는
   * `/final`·`/final-html`이 그대로 서빙할 수 있도록 저장된다(최근
   * 성공한 결과가 "지금의 최종 상세페이지"가 된다).
   */
  @Post(":id/story")
  @PublicInDev()
  async generateStory(
    @Param("id") id: string,
    @Body() body: GenerateProductStoryRequest = {},
  ): Promise<ProductStoryResultDto> {
    if (
      body?.userRequirement !== undefined &&
      body.userRequirement !== null &&
      typeof body.userRequirement !== "string"
    ) {
      throw new BadRequestException("userRequirement는 문자열 또는 null이어야 합니다.");
    }
    const validatedUserRequirement =
      body?.userRequirement === undefined ? undefined : validateOrThrow(body.userRequirement, "userRequirement");
    return this.service.generateStory(id, validatedUserRequirement);
  }

  /** 최근 실행 목록 */
  @Get()
  async list(
    @Query("take") take?: string,
  ): Promise<{ results: ProductProfileDto[] }> {
    return { results: await this.service.list(Number(take ?? "20")) };
  }
}
