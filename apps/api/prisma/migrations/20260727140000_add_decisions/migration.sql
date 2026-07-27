-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reason" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decisions_projectId_idx" ON "decisions"("projectId");

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

