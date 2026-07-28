-- CreateTable
CREATE TABLE "content_status_history" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "fromStatus" "ContentStatus" NOT NULL,
    "toStatus" "ContentStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_status_history_contentId_createdAt_idx" ON "content_status_history"("contentId", "createdAt");

-- AddForeignKey
ALTER TABLE "content_status_history" ADD CONSTRAINT "content_status_history_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

