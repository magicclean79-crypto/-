-- AlterTable
ALTER TABLE "users" ADD COLUMN     "disabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_audit_log" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetEmail" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_audit_log_createdAt_idx" ON "user_audit_log"("createdAt");

