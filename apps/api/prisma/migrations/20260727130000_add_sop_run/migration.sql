-- CreateEnum
CREATE TYPE "SopRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "sop_runs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sopKey" TEXT NOT NULL,
    "status" "SopRunStatus" NOT NULL DEFAULT 'RUNNING',
    "steps" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sop_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sop_runs_projectId_idx" ON "sop_runs"("projectId");

-- AddForeignKey
ALTER TABLE "sop_runs" ADD CONSTRAINT "sop_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

