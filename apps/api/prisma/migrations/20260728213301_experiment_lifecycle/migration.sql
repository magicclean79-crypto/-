-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('RUNNING', 'STOPPED', 'PROMOTED');

-- CreateTable
CREATE TABLE "experiment_states" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'RUNNING',
    "promotedVariant" TEXT,
    "actor" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_events" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "ExperimentStatus" NOT NULL,
    "toStatus" "ExperimentStatus" NOT NULL,
    "fromVariant" TEXT,
    "toVariant" TEXT,
    "actor" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_assignments" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "experiment_states_feature_key" ON "experiment_states"("feature");

-- CreateIndex
CREATE INDEX "experiment_events_stateId_createdAt_idx" ON "experiment_events"("stateId", "createdAt");

-- CreateIndex
CREATE INDEX "experiment_assignments_feature_variantKey_idx" ON "experiment_assignments"("feature", "variantKey");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_assignments_feature_projectId_key" ON "experiment_assignments"("feature", "projectId");

-- AddForeignKey
ALTER TABLE "experiment_events" ADD CONSTRAINT "experiment_events_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "experiment_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "experiment_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;
