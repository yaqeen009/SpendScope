-- Refund linkage and manual transfer pairing.
--
-- `refundOfTransactionId` links a REFUND row to the EXPENSE it reverses. The
-- API enforces that the refund inherits the original's category, so existing
-- category-level net-spend aggregation stays correct without extra SQL.
--
-- `transferGroupId` marks the two sides of a manually paired account transfer.
-- Transfers are already excluded from income/expense totals, so pairing changes
-- presentation and reconciliation only, never the numbers.
--
-- Both columns are nullable and both foreign keys use ON DELETE SET NULL, so
-- deleting a transaction never cascades into unrelated rows.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "refundOfTransactionId" UUID,
                           ADD COLUMN "transferGroupId" UUID;

-- CreateIndex
CREATE INDEX "Transaction_refundOfTransactionId_idx" ON "Transaction"("refundOfTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_transferGroupId_idx" ON "Transaction"("transferGroupId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_refundOfTransactionId_fkey" FOREIGN KEY ("refundOfTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
