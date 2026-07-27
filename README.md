# AI Product Content OS

AI 기반 제품 콘텐츠 운영 시스템(Monorepo)입니다. pnpm + Turborepo로 관리됩니다.

## 프로젝트 구조

```
ai-product-content-os/
 ├─ apps/
 │   ├─ web            # Next.js (TypeScript, Tailwind CSS) — http://localhost:3000
 │   └─ api            # NestJS + Prisma — http://localhost:4000
 ├─ packages/
 │   ├─ core           # 도메인 로직 (@acos/core)
 │   ├─ shared         # 공용 타입/유틸/상수 (@acos/shared)
 │   ├─ agents         # AI 에이전트 (@acos/agents)
 │   └─ ui             # 공용 React UI 컴포넌트 (@acos/ui)
 ├─ docs               # 문서
 ├─ infrastructure     # 인프라 구성 (Docker, IaC)
 ├─ scripts            # 운영/개발 스크립트
 ├─ tests              # 통합/E2E 테스트
 ├─ docker-compose.yml # PostgreSQL, Redis, MinIO
 └─ turbo.json
```

## 요구 사항

- Node.js >= 20
- pnpm >= 10 (`corepack enable` 권장)
- Docker (PostgreSQL / Redis / MinIO 실행용)

## 시작하기

```bash
# 1. 의존성 설치
pnpm install

# 2. (선택) 인프라 실행 — PostgreSQL, Redis, MinIO
pnpm docker:up

# 3. (선택) 환경 변수 설정
cp .env.example apps/api/.env

# 4. 개발 서버 실행 (web + api 동시 실행)
pnpm dev
```

- Web: <http://localhost:3000>
- API Health: <http://localhost:4000/health> → `OK`
- MinIO Console: <http://localhost:9001> (minioadmin / minioadmin)

> DB가 실행 중이 아니어도 web/api는 정상 기동됩니다. Prisma 마이그레이션 등 DB 작업 시에만 `pnpm docker:up`이 필요합니다.

## 주요 명령어

| 명령어 | 설명 |
| --- | --- |
| `pnpm dev` | web + api + 패키지 watch 동시 실행 |
| `pnpm build` | 전체 빌드 (Turborepo 캐시 적용) |
| `pnpm lint` | 전체 린트 |
| `pnpm docker:up` / `pnpm docker:down` | 인프라 기동 / 종료 |
| `pnpm prisma:generate` | Prisma Client 생성 |
| `pnpm prisma:migrate` | DB 마이그레이션 (`prisma migrate dev`) |
| `pnpm prisma:studio` | Prisma Studio 실행 |

## 사진 업로드 (TASK-0201)

- 업로드 화면: <http://localhost:3000/upload> — 드래그 앤 드롭, 다중 업로드, 진행률 표시
- 저장소: MinIO 버킷 `acos` (`images/{yyyy}/{mm}/{uuid}.{ext}` 키로 저장, public-read)
- 메타데이터: PostgreSQL `images` 테이블 (Prisma `Image` 모델)

### 업로드 API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/uploads/images` | `multipart/form-data`, 필드명 `files` (최대 10개, 파일당 10MB, jpeg/png/webp/gif) |
| `GET` | `/uploads/images?take=20` | 최근 업로드 목록 |

성공 응답(201):

```json
{
  "images": [
    {
      "id": "cml…",
      "key": "images/2026/07/….jpg",
      "url": "http://localhost:9000/acos/images/2026/07/….jpg",
      "originalName": "photo.jpg",
      "mimeType": "image/jpeg",
      "size": 123456,
      "productId": null,
      "createdAt": "2026-07-27T00:00:00.000Z"
    }
  ]
}
```

오류: `400` 파일 없음/형식 불일치, `413` 10MB 초과, `503` MinIO/DB 연결 불가.

## Prisma

- 스키마: `apps/api/prisma/schema.prisma`
- 연결 문자열: `DATABASE_URL` (기본값 `postgresql://postgres:postgres@localhost:5432/acos`)

```bash
pnpm docker:up                 # PostgreSQL 기동
cp .env.example apps/api/.env  # 환경 변수 준비
pnpm prisma:migrate            # 마이그레이션 생성/적용
```
