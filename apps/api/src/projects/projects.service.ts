import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateProjectRequest,
  ProjectDetailDto,
  ProjectDto,
  ProjectListItemDto,
  UpdateProjectRequest,
} from "@acos/shared";
import type { Project } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const NAME_MAX_LENGTH = 200;

function toDto(project: Project): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function validateName(name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed || trimmed.length > NAME_MAX_LENGTH) {
    throw new BadRequestException(
      `이름은 1~${NAME_MAX_LENGTH}자여야 합니다.`,
    );
  }
  return trimmed;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(request: CreateProjectRequest): Promise<ProjectDto> {
    const project = await this.prisma.project.create({
      data: {
        name: validateName(request.name),
        description: request.description?.trim() || null,
      },
    });
    return toDto(project);
  }

  async list(take: number): Promise<ProjectListItemDto[]> {
    const bounded = Math.min(
      Math.max(Number.isFinite(take) ? take : 20, 1),
      100,
    );
    const projects = await this.prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      take: bounded,
      include: {
        _count: { select: { products: true, productObjects: true } },
      },
    });
    return projects.map((project) => ({
      ...toDto(project),
      productCount: project._count.products,
      productObjectCount: project._count.productObjects,
    }));
  }

  async getById(id: string): Promise<ProjectDetailDto> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        products: {
          orderBy: { createdAt: "desc" },
          include: {
            images: { orderBy: { createdAt: "asc" }, take: 1 },
            _count: { select: { images: true } },
          },
        },
        productObjects: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true },
        },
      },
    });
    if (!project) {
      throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${id}`);
    }
    return {
      ...toDto(project),
      products: project.products.map((product) => ({
        id: product.id,
        projectId: product.projectId,
        name: product.name,
        description: product.description,
        imageCount: product._count.images,
        thumbnailUrl: product.images[0]?.url ?? null,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
      })),
      latestProductObjectVersion: project.productObjects[0]?.version ?? null,
    };
  }

  async update(id: string, request: UpdateProjectRequest): Promise<ProjectDto> {
    const data: { name?: string; description?: string | null } = {};
    if (request.name !== undefined) {
      data.name = validateName(request.name);
    }
    if (request.description !== undefined) {
      data.description = request.description?.trim() || null;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("수정할 내용이 없습니다.");
    }
    await this.ensureExists(id);
    const project = await this.prisma.project.update({ where: { id }, data });
    return toDto(project);
  }

  /** 프로젝트 삭제 — 상품·Product Object가 함께 삭제되고 이미지는 연결만 해제된다 */
  async remove(id: string): Promise<{ deleted: true }> {
    await this.ensureExists(id);
    await this.prisma.project.delete({ where: { id } });
    return { deleted: true };
  }

  private async ensureExists(id: string): Promise<void> {
    const found = await this.prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${id}`);
    }
  }
}
