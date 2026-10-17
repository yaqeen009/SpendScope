# Financial rules

Every figure the app shows is derived from the transaction table by the rules
below. The rules are implemented once in
[`apps/api/src/lib/finance.ts`](../apps/api/src/lib/finance.ts) and
[`packages/shared/src/money.ts`](../packages/shared/src/money.ts), and the
database aggregates are in
[`apps/api/src/lib/aggregates.ts`](../apps/api/src/lib/aggregates.ts). Any change
must update this document.

## 1. Money

- Amounts are stored as a **positive magnitude** (`DECIMAL(14,2)`) with an
  explicit `type`. Direction never comes from a sign.
- On the wire amounts are decimal **strings**. They are never JavaScript
  numbers.
- Arithmetic converts strings to integer **minor units** (`BigInt`) before
  adding or comparing, so `0.1 + 0.2` style errors cannot occur.
- Percentage and share figures are the only places a float appears, and only
  after the exact sum is computed.

## 2. Period definitions

A period is always **inclusive** of both ends: a transaction is in range when
`start <= transactionDate <= end`.

| Period key | Range |
| ---------- | ----- |
| `this_month` | 1st of the current month → last day of the current month |
| `last_month` | the whole previous calendar month |
| `last_3_months` | 1st of the month two months ago → last day of the current month |
| `this_year` | 1 January → 31 December of the current year |
| `custom` | the supplied `from`/`to` (swapped if reversed) |

"Today" is the local calendar date of the server/renderer; dates are stored as
UTC `DATE` values, so a calendar day never shifts across timezones.

### Comparison period (`compare`)

- **Month-aligned** ranges are shifted back by whole months, so "March" compares
  with "February" even though the month lengths differ.
- Any other range is shifted back by its own day count, giving a previous window
  of identical length.

### Time-series granularity

Chosen from the range length so charts stay readable: ≤ 45 days → daily;
≤ 130 days → weekly; otherwise monthly. Empty buckets are emitted as zero so the
axis never collapses.

## 3. Period metrics

For a period with the transactions in range (`a` = amount, all magnitudes):

```text
refunds   = Σ a where type = REFUND
expenses  = (Σ a where type = EXPENSE)  −  refunds
income    = Σ a where type = INCOME
net       = income − expenses
```

- `TRANSFER` transactions are **excluded from all four** figures above. They
  still count toward `transactionCount` and appear in the transaction list.
- `expenses` is **not clamped at zero**. A refund with no matching expense
  legitimately produces a negative net spend, and showing that is more honest
  than hiding it.
- `savingsRate = net / income` as a fraction, or `null` when income ≤ 0. `null`
  renders as "unavailable", never as `NaN`/`Infinity`/`0`.
- `transactionCount` counts every transaction in range, including transfers.
- `uncategorizedExpenseTotal` / `uncategorizedCount` cover only uncategorized
  `EXPENSE` and `REFUND` rows, with refunds subtracted like elsewhere.

### Percentage change

`percentChange(current, previous) = (current − previous) / previous`, or `null`
when `previous = 0` (there is no meaningful percentage change from zero). This
applies to income, expenses and net. For the savings rate the change is the
**difference in percentage points** (`current − previous`), or `null` when
either side is `null`.

## 4. Category breakdown

- Net spend per category = `Σ EXPENSE − Σ REFUND` for that category over the
  range.
- Uncategorized rows are aggregated into a synthetic `Uncategorized` entry
  (only when non-empty) so the parts always sum to the visible total.
- `share = category total / grand total`; when the grand total is 0 the share is
  0 rather than `NaN`.
- Categories with no activity are **omitted** (they are not shown as zero bars).
- The grand total equals the sum of expense−refund across all categories, so it
  reconciles with `expenses` in the period metrics.

## 5. Budgets

- A budget is either for one **expense** category or the single **total monthly
  expense budget** (`categoryId = null`). Budgets on income categories are
  rejected.
- `month` is always stored as the first day of the month. Amounts must be
  greater than zero.
- `spent` for a category budget is that category's net expense spend
  (EXPENSE − REFUND) for the month; `spent` for the total budget is the net
  expense spend of the whole month (including uncategorized).
- `remaining = budgetAmount − spent` (may be negative when exceeded).
- `percentUsed = spent / budgetAmount`, or `0` when the budget amount is 0
  (never `Infinity`).

### State thresholds

| `percentUsed` | State |
| ------------- | ----- |
| `< 0.80` | `ok` |
| `0.80 ≤ x ≤ 1.00` | `warning` |
| `> 1.00` | `exceeded` |

The threshold is inclusive at 80% and at 100%; only **over** 100% is
`exceeded`.

## 6. Transaction types

| Type | Direction | In totals |
| ---- | --------- | --------- |
| `INCOME` | Money in | income |
| `EXPENSE` | Money out | expenses |
| `REFUND` | Money back against spend | subtracted from expenses |
| `TRANSFER` | Between your own accounts | excluded from every metric |

## 7. CSV import rules

### Accepted dates

`YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY.MM.DD`, `YYYYMMDD`, ISO timestamps
(`2026-03-01T00:00:00Z`), `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`, and 10/13
digit epoch values.

**Ambiguity rule:** when a day-first and month-first reading are both valid
(`01/02/2026`), the value is interpreted **day-first** (`1 February 2026`). When
only one reading is valid (e.g. `25/12/2026`), that reading is used. This is a
documented, deterministic choice — not a guess.

### Accepted amounts

Currency symbols (`$ € £ ₵ ¥`), currency codes (`GHS`, `USD`), thousands
separators, leading/trailing signs, and accounting parentheses `(123.45)` for
negatives are all handled. Values are rounded to cents with **half-up**
rounding, computed on integers (never floats).

### Type inference

1. If the file has a type column and it maps to a known value, use it
   (`credit`/`deposit`/`cr` → `INCOME`, `debit`/`withdrawal`/`dr` → `EXPENSE`,
   `transfer` → `TRANSFER`, `refund`/`reversal`/`chargeback` → `REFUND`, and
   similar aliases).
2. Else, if a separate credit column is mapped, a value in the credit column is
   `INCOME` and a value in the amount column is `EXPENSE`.
3. Else, the sign decides: negative → `EXPENSE`, positive → `INCOME`.

Amounts are stored as magnitudes; the sign is discarded once the type is known.

### Row validation

A row is **invalid** when the date is missing/unparseable, the description is
empty, the amount is missing/unparseable, or an explicit type cell is
unrecognised. Invalid rows are reported with a reason and never imported.

### Duplicates

- **Exact duplicate** — identical fingerprint (see
  [DATA_MODEL.md](DATA_MODEL.md#duplicate-detection)). Skipped by default;
  reported as `duplicateRows`.
- **Possible duplicate** — same date and amount, different wording. Flagged so
  the user decides; the user may keep or skip it.
- Duplicates inside the same file are also detected.

### Returning money and refunds

A `REFUND` reduces the period's expenses. Because there is no explicit link
between a refund and the expense it reverses, the reduction is applied to the
category of the refund row (or to uncategorized spend when the refund is
uncategorized).

## 8. Categorisation

Category suggestions are a **deterministic keyword heuristic**, not machine
learning and not "AI". Rules match known merchant keywords in the normalised
description/merchant text and are evaluated in order — the first match wins.
Income rules only apply to income rows and expense rules to expense/refund rows.

When nothing matches, the transaction stays **uncategorized**. The app never
invents a category. Every suggestion is shown in the import wizard and can be
changed before the rows are stored.

## 9. Insights

Insights are plain arithmetic statements over the same aggregates the charts
use. Each states the figure it is based on. The rules, in order:

| Condition | Insight |
| --------- | ------- |
| income > 0 or expenses > 0 and net ≥ 0 | "Ended the period in surplus" (with savings rate, or a note that it is unavailable when income is 0) |
| …and net < 0 | "Spent more than earned" |
| top category ≥ 30% of spending | "Largest category" |
| expenses up ≥ 15% vs previous | "Spending increased" |
| expenses down ≥ 15% vs previous | "Spending decreased" |
| any budget exceeded | "N budget(s) exceeded" |
| else any budget in warning | "N budget(s) approaching the limit" |
| any uncategorized rows | "N uncategorized transaction(s)" |
| Subscriptions category total > 0 | "Recurring subscriptions" |
| any expense in range | "Largest single expense" |
| none of the above | "Not enough data yet" |

## 10. Currency

The `currency` setting is **display-only**. SpendScope performs **no currency
conversion** and stores no exchange rates. Changing the currency only changes
the symbol and formatting used when rendering; the underlying numbers are
untouched. Mixed-currency data is out of scope for this version.
