-- CreateEnum
CREATE TYPE "PhotoType" AS ENUM ('DESIGN', 'INFO');

-- AlterTable
ALTER TABLE "images" ADD COLUMN "photoType" "PhotoType";
