-- Per-transaction currency, plus a reserved exchange-rate table.
--
-- `Transaction.currency` NULL means the workspace base currency, which is what
-- every pre-existing row is. No conversion is performed anywhere: foreign
-- currency rows are excluded from aggregated totals instead, so a total can
-- never silently mix currencies.
--
-- `ExchangeRate` is created but not read by any query. It is reserved for a
-- future conversion feature and documented as such in the schema.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "currency" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_workspaceId_currency_idx" ON "Transaction"("workspaceId", "currency");

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "asOf" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_workspaceId_fromCurrency_toCurrency_asOf_key" ON "ExchangeRate"("workspaceId", "fromCurrency", "toCurrency", "asOf");

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
