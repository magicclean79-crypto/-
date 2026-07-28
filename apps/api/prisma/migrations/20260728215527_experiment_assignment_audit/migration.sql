-- CreateTable
CREATE TABLE "experiment_assignment_events" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "fromVariant" TEXT,
    "toVariant" TEXT NOT NULL,
    "fromSignature" TEXT,
    "toSignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_assignment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "experiment_assignment_events_feature_createdAt_idx" ON "experiment_assignment_events"("feature", "createdAt");
