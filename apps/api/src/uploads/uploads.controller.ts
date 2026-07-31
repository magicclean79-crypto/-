import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import {
  UPLOAD_ALLOWED_MIME_TYPES,
  UPLOAD_MAX_FILES,
  UPLOAD_MAX_FILE_SIZE,
  UploadImagesResponse,
} from "@acos/shared";
import { UploadsService } from "./uploads.service";

@Controller("uploads")
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post("images")
  @UseInterceptors(
    FilesInterceptor("files", UPLOAD_MAX_FILES, {
      limits: { fileSize: UPLOAD_MAX_FILE_SIZE },
      fileFilter: (_req, file, callback) => {
        if (
          (UPLOAD_ALLOWED_MIME_TYPES as readonly string[]).includes(
            file.mimetype,
          )
        ) {
          callback(null, true);
        } else {
          callback(
            new BadRequestException(
              `지원하지 않는 파일 형식입니다: ${file.mimetype} (허용: ${UPLOAD_ALLOWED_MIME_TYPES.join(", ")})`,
            ),
            false,
          );
        }
      },
    }),
  )
  async uploadImages(
    @UploadedFiles() files: Express.Multer.File[],
    // 소속을 여기서 받는다 (TASK-4501, CTO 정책 4501-②). multipart 본문은
    // 파일과 섞이므로 쿼리로 받되, 값의 확인은 서비스가 한다.
    @Query("projectId") projectId?: string,
    @Body("projectId") bodyProjectId?: string,
  ): Promise<UploadImagesResponse> {
    const images = await this.uploadsService.uploadImages(
      files,
      projectId ?? bodyProjectId,
    );
    return { images };
  }

  @Get("images")
  async listImages(
    @Query("take") take?: string,
  ): Promise<UploadImagesResponse> {
    const images = await this.uploadsService.listImages(Number(take ?? "20"));
    return { images };
  }
}
