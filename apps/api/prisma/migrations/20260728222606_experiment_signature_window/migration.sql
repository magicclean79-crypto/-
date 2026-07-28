-- AlterTable
ALTER TABLE "experiment_states" ADD COLUMN     "signature" TEXT,
ADD COLUMN     "signatureChangedAt" TIMESTAMP(3);
