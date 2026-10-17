# SpendScope — Full-Stack Personal Finance Analytics

## 1. Your Role

Act as a senior full-stack software engineer, UI/UX designer, database architect, and QA engineer.

Build **SpendScope**, a polished, responsive personal finance analytics application that helps users understand their spending patterns by importing transaction data, categorizing expenses, reviewing income versus expenses, and exploring financial trends through interactive visualizations.

This is an actual software project, not a static dashboard mockup. Build a working application with a real backend, persistent database storage, validated data imports, functional filters, meaningful analytics, and automated tests.

Use good engineering judgment, but follow the requirements below. Do not stop after creating a plan or a visually impressive frontend.

## 2. Product Vision

SpendScope should help users answer questions such as:

- How much money did I earn and spend this month?
- Which categories account for most of my spending?
- How has my spending changed over time?
- What are my biggest individual expenses?
- Am I staying within my monthly category budgets?
- Which transactions need to be reviewed or categorized?
- How does this month compare with the previous month?

### Target users

Students, young professionals, and individuals who want to understand their finances without connecting their bank accounts to a third-party service.

### Product principles

1. **Privacy first:** financial data should remain in the user's application and database. Do not send transactions to external AI services or analytics providers.
2. **Data accuracy:** totals, comparisons, categorization, and date filters must be mathematically correct.
3. **Transparency:** clearly distinguish imported data, sample data, and derived insights.
4. **Usability:** a user should be able to import a CSV and understand the resulting dashboard without needing technical knowledge.
5. **Accessible design:** support keyboard navigation, readable contrast, useful empty states, and responsive layouts.
6. **No fake functionality:** every visible control must work or be clearly marked as unavailable.

## 3. Technology Stack

Use the following stack unless an actual compatibility issue requires a documented alternative.

### Frontend
- React
- TypeScript with strict mode
- Vite
- Tailwind CSS
- shadcn/ui where useful
- Lucide React icons
- Recharts for data visualizations
- React Router for navigation
- TanStack Query for server-state management
- React Hook Form and Zod for form validation

### Backend
- Node.js
- TypeScript
- Express
- Zod for request validation
- A structured logging solution suitable for development and production

### Database and persistence
- PostgreSQL
- Prisma ORM
- Database migrations committed to the repository
- Seed script for clearly labeled demo data

### Testing
- Vitest
- React Testing Library
- Supertest for API tests
- Playwright for browser-level end-to-end tests when the environment supports it

Use stable, mutually compatible package versions. Do not blindly install the latest versions if they introduce compatibility issues. Follow the installed versions' documentation, especially for Prisma configuration and database connections.

Use a monorepo structure with separate frontend and backend applications. Avoid unnecessary microservices.

## 4. Application Structure

Prefer a structure similar to:

```text
spendscope/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── features/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── transactions/
│   │   │   │   ├── imports/
│   │   │   │   ├── categories/
│   │   │   │   ├── budgets/
│   │   │   │   └── settings/
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   ├── pages/
│   │   │   ├── routes/
│   │   │   └── test/
│   │   └── package.json
│   └── api/
│       ├── src/
│       │   ├── config/
│       │   ├── middleware/
│       │   ├── modules/
│       │   │   ├── transactions/
│       │   │   ├── imports/
│       │   │   ├── categories/
│       │   │   ├── budgets/
│       │   │   └── analytics/
│       │   ├── lib/
│       │   ├── app.ts
│       │   └── server.ts
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/
│       │   └── seed.ts
│       └── package.json
├── packages/
│   └── shared/
├── docs/
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── OPENCODE_SPEC.md
```

Adapt the structure where necessary, but preserve clear separation between presentation, business logic, API endpoints, and database operations.

If a shared package creates unnecessary complexity, keep shared validation schemas and types organized without introducing a complicated build system.

## 5. Design and User Experience

Create a premium personal finance product, not a generic admin template.

### Visual direction

- Minimal, modern, data-focused interface.
- Neutral backgrounds, refined borders, subtle shadows, and generous spacing.
- A restrained green or teal accent for positive financial indicators.
- Clear typography and strong information hierarchy.
- Consistent spacing, typography, border radii, and icon sizing.
- Light and dark themes.
- Subtle transitions and useful hover/focus states.
- Avoid excessive gradients, decorative animations, oversized cards, and unnecessary glassmorphism.
- Use animation sparingly; respect reduced-motion preferences.

Aim for a product that looks credible in a professional developer portfolio.

### Application layout

On desktop, use a collapsible sidebar with:

- Overview
- Transactions
- Analytics
- Budgets
- Categories
- Settings

The main content area should have a consistent header containing the page title, date range controls where relevant, and contextual actions.

On mobile, replace the desktop sidebar with an accessible mobile navigation pattern. Tables, filters, charts, and dialogs must remain usable on narrow screens.

### Dashboard page

Build a high-quality overview screen with:

1. A welcome/header section with the selected reporting period.
2. Summary cards for:
   - Total income
   - Total expenses
   - Net cash flow
   - Savings rate
3. An income-versus-expenses chart over time.
4. A category spending breakdown chart.
5. A monthly spending trend.
6. A recent transactions table.
7. A budget progress section.
8. A small insights section based on transparent, deterministic calculations.

Each chart must have proper labels, tooltips, useful empty states, and accessible descriptions where possible.

All figures must come from the backend or from a clearly identified demo dataset. Do not hardcode numbers into dashboard components.

### Summary card behavior

- Income is calculated from qualifying income transactions.
- Expenses are calculated from qualifying expense transactions.
- Net cash flow equals income minus expenses.
- Savings rate is calculated as net cash flow divided by income when income is greater than zero.
- When income is zero, show an appropriate unavailable state rather than NaN or infinity.
- Comparison percentages must handle zero-valued previous periods without division errors.
- Clearly label the reporting period used for each metric.

Do not present savings rate as a measure of investment returns or financial advice.

## 6. Core Features

### A. Dashboard and analytics

Implement a real dashboard powered by aggregated transaction data.

Users should be able to select:

- This month
- Last month
- Last three months
- This year
- A custom date range

Changing the date range must update the summary cards, charts, recent transactions, and relevant category summaries consistently.

Support comparisons with the equivalent previous period where appropriate.

The backend should calculate financial aggregates. Do not download every transaction and calculate all analytics only in the browser.

Implement at least these analytics:

- Income and expenses by day, week, or month, depending on the selected range.
- Expenses grouped by category.
- Largest expense transactions.
- Spending trends across months.
- Budget usage for the selected period.
- Uncategorized transaction totals.

Write tests for the calculations, including boundary dates, empty datasets, and zero-income periods.

### B. Transaction management

Build a complete transaction management page.

Users must be able to:

- View transactions in a paginated table.
- Search descriptions and merchant names.
- Filter by date range, category, transaction type, and review status.
- Sort by date, amount, and description.
- View transaction details.
- Create transactions manually.
- Edit transactions.
- Delete transactions after confirmation.
- Change categories.
- Mark transactions as reviewed or needing review.

Each transaction should contain, as appropriate:

- ID
- Transaction date
- Description
- Merchant or counterparty
- Amount
- Transaction type
- Category
- Optional notes
- Import source
- Review status
- Created and updated timestamps

Use consistent monetary conventions throughout the app. Represent stored monetary amounts using PostgreSQL decimal types and safe decimal arithmetic, not floating-point arithmetic for financial calculations.

Define and document whether expenses are stored as positive amounts with an explicit transaction type, or as signed amounts. Choose one consistent convention and enforce it everywhere.

### C. CSV import wizard

CSV import is a central feature. It must work end to end.

Build a guided import process with the following stages:

**Stage 1: Upload**

- Accept CSV files.
- Display the filename and file size.
- Validate file type and size.
- Provide a downloadable sample CSV template.
- Do not upload files to external services.

**Stage 2: Parse and map columns**

- Parse CSV files correctly, including quoted fields and commas inside quoted descriptions.
- Preview the first several rows.
- Allow users to map their columns to:
  - Date
  - Description
  - Amount
  - Transaction type, if available
  - Category, if available
  - Merchant, if available
  - Notes, if available
- Detect likely mappings automatically when possible.
- Let users correct mappings before continuing.

Do not assume every bank exports the same CSV format.

**Stage 3: Validate**

Validate each row independently.

Handle:

- Missing required fields.
- Invalid dates.
- Invalid monetary amounts.
- Unsupported transaction types.
- Empty descriptions.
- Invalid encodings where detectable.
- Duplicate rows.
- Malformed CSV input.

Show valid row counts, invalid row counts, duplicate counts, and row-level error messages.

Allow users to inspect errors and download an error report when practical.

**Stage 4: Categorize**

Provide deterministic rule-based categorization suggestions based on descriptions and merchant names.

Examples of possible rules:

- A description containing a recognizable grocery merchant can suggest Groceries.
- A transport-related merchant can suggest Transport.
- A utility payment can suggest Bills and Utilities.

These are suggestions, not guaranteed classifications. Do not claim that keyword matching understands every transaction.

Users must be able to review or change suggested categories. Unrecognized transactions should remain uncategorized rather than being assigned an arbitrary category.

**Stage 5: Review and import**

- Show a final preview of transactions to be imported.
- Clearly distinguish valid, invalid, and duplicate rows.
- Let the user choose whether to skip invalid rows or return to fix the file.
- Import valid, approved rows through the backend.
- Use database transactions or equivalent safe batching so partial imports do not leave the database in an inconsistent state.
- Report the actual number of created, skipped, duplicated, and rejected rows.
- Prevent accidental repeated imports from silently duplicating transactions.

Create an import history containing the import timestamp, filename, row counts, and outcome.

Do not retain raw CSV contents or original files unnecessarily. If the file must be temporarily stored, document the retention behavior and ensure cleanup.

### D. Duplicate detection

Implement duplicate detection with transparent behavior.

Use a documented combination of fields such as transaction date, normalized description, amount, type, and merchant to identify likely duplicates.

Requirements:

- Do not rely on descriptions alone.
- Do not assume two identical transactions on the same day are always duplicates.
- Distinguish exact duplicates from possible duplicates where practical.
- Let users review ambiguous cases.
- Use database constraints or idempotency mechanisms where appropriate to prevent repeated requests from importing the same rows twice.
- Report skipped duplicates in the import summary.

Document the limitations of fingerprint-based detection.

### E. Categories

Provide sensible default categories, including:

Income:
- Salary
- Freelance
- Business Income
- Interest
- Other Income

Expenses:
- Housing
- Groceries
- Transport
- Utilities
- Healthcare
- Education
- Shopping
- Entertainment
- Dining
- Subscriptions
- Personal Care
- Other Expenses

Users should be able to:

- View categories.
- Create categories.
- Edit category names and colors.
- Change category assignments.
- View spending totals by category.
- Identify categories that have no transactions.

Prevent accidental category deletion from breaking historical transactions. Use an explicit reassignment or uncategorized fallback strategy.

Support user-defined categories without requiring code changes.

### F. Budgets

Implement monthly spending budgets.

Users should be able to:

- Set a total monthly expense budget.
- Create category-specific monthly budgets.
- Edit and remove budgets.
- View actual spending against each budget.
- See remaining budget and percentage used.
- Identify exceeded budgets.

Use clear visual indicators for normal, approaching-limit, and exceeded states.

Calculate progress using actual qualifying expense transactions in the relevant month. Do not count income as expense or count internal transfers as spending.

If a budget has no spending, display zero usage correctly.

### G. Settings

Provide functional settings for:

- Preferred currency.
- Theme preference.
- Default reporting period.
- Category management access.
- Demo data reset.

Use Ghanaian cedi (GHS) as the initial default currency, while allowing users to choose another supported currency.

Use proper currency formatting through `Intl.NumberFormat` and locale-aware date formatting.

Changing the display currency must not silently convert existing monetary values. Until exchange-rate conversion is explicitly implemented, state clearly that this setting changes display formatting only and that imported amounts are assumed to be in the same base currency.

Provide an understandable confirmation before deleting demo data or resetting application data.

## 7. Data Model

Design a normalized Prisma schema that supports the core features.

At minimum, model the following concepts:

### Transaction

Fields should include:

- ID
- Transaction date
- Description
- Normalized description or merchant field as appropriate
- Decimal amount
- Transaction type
- Optional category relation
- Optional notes
- Review status
- Import batch relation when applicable
- Optional duplicate fingerprint
- Created and updated timestamps

### Category

Include:

- ID
- Name
- Transaction type or category classification
- Optional color
- Optional description
- Default/custom indicator
- Created and updated timestamps

### Budget

Include:

- ID
- Optional category relation for category budgets
- Budget amount
- Period or month identifier
- Created and updated timestamps

Define a clear rule for total monthly budgets versus category budgets and enforce it in validation.

### ImportBatch

Include:

- ID
- Original filename
- Import timestamp
- Total rows
- Created rows
- Skipped duplicate rows
- Invalid or rejected rows
- Import status
- Useful non-sensitive metadata

### User or workspace boundary

The initial MVP may be a single-user local application without full authentication. However, structure the database and service layer so that adding authenticated multi-user support later does not require rewriting every feature.

Clearly document that a deployment without authentication is suitable only for a trusted local environment or a properly protected private deployment.

Do not expose the application publicly with unrestricted access to other users' financial data.

### Data integrity

- Use appropriate database indexes.
- Use foreign keys and sensible deletion behavior.
- Enforce unique constraints where they represent true invariants.
- Store monetary values with a suitable decimal precision.
- Use UTC timestamps for system events and handle transaction dates consistently.
- Preserve historical transaction dates independently of import timestamps.
- Document migration and seed procedures.

Do not add unnecessary database models merely to make the architecture look sophisticated.

## 8. API Design

Implement versioned REST endpoints under `/api/v1`.

At minimum, provide endpoints for:

### Transactions

- `GET /api/v1/transactions`
- `GET /api/v1/transactions/:id`
- `POST /api/v1/transactions`
- `PATCH /api/v1/transactions/:id`
- `DELETE /api/v1/transactions/:id`

Support pagination, filtering, sorting, and search with validated query parameters.

### Imports

- `POST /api/v1/imports/preview`
- `POST /api/v1/imports`
- `GET /api/v1/imports`
- `GET /api/v1/imports/:id`

Choose an appropriate preview strategy. If a server-side preview token or temporary import session is required, implement expiration and cleanup. Do not trust client-submitted preview data blindly during the final import.

### Categories

- `GET /api/v1/categories`
- `POST /api/v1/categories`
- `PATCH /api/v1/categories/:id`
- `DELETE /api/v1/categories/:id`

### Budgets

- `GET /api/v1/budgets`
- `POST /api/v1/budgets`
- `PATCH /api/v1/budgets/:id`
- `DELETE /api/v1/budgets/:id`

### Analytics

Provide endpoints for:

- Summary metrics.
- Income versus expenses over time.
- Spending by category.
- Monthly trends.
- Recent transactions.
- Budget progress.

### Settings and health

Implement the necessary settings endpoints and:

- `GET /api/v1/health`

Use a consistent JSON response format and a centralized error-handling middleware.

Validate all external input with Zod or an equivalent runtime validator.

Use appropriate HTTP status codes. Never expose stack traces, secrets, raw database errors, or sensitive implementation details in production responses.

## 9. Financial Logic

Implement and test the financial calculations in reusable functions or services.

Define the following clearly:

- Income total.
- Expense total.
- Net cash flow.
- Savings rate.
- Spending by category.
- Budget usage.
- Previous-period comparison.
- Monthly trend.
- Duplicate fingerprint generation.

If transaction types include transfers, refunds, or adjustments, define their behavior explicitly before including them in financial summaries.

Do not count a transfer between a user's own accounts as ordinary income or expense. If account-level transfer tracking is outside the MVP, document the limitation and do not pretend the app can reliably recognize all transfers automatically.

Use decimal-safe arithmetic for monetary calculations. Convert decimal results to JSON using a consistent, documented representation.

For date ranges, define inclusive start and end semantics and apply them consistently in the frontend and backend.

Avoid timezone bugs when querying date-only transaction fields.

Add unit tests for:

- Positive and negative cash flow.
- Zero income.
- Empty transaction sets.
- Month boundaries.
- Leap years.
- Previous-period comparisons.
- Uncategorized expenses.
- Refunds and transfers if supported.
- Decimal precision.
- Budget thresholds.
- Duplicate detection edge cases.

## 10. Security and Privacy

Even a local finance app must be designed responsibly.

- Never commit `.env` files or database credentials.
- Provide `.env.example` with placeholders only.
- Validate file sizes and CSV content.
- Do not trust client-supplied monetary totals or transaction IDs.
- Use parameterized ORM queries.
- Configure CORS narrowly for the intended frontend origin.
- Apply reasonable request-size limits and rate limits to sensitive endpoints.
- Avoid logging transaction descriptions, full imported rows, or other unnecessary financial details.
- Avoid unsafe HTML rendering of imported descriptions.
- Do not execute formulas or treat CSV content as executable code.
- Escape CSV fields correctly when generating downloadable reports.
- Keep error responses free of sensitive information.
- Never send transaction data to third-party AI APIs, analytics services, or external servers.
- Document the risks of running without authentication.

If authentication is not implemented in the MVP, clearly state that the backend must not be exposed to an untrusted network. Do not invent an insecure authentication shortcut.

## 11. Demo Mode and Seed Data

Create a useful demo dataset so the dashboard looks complete immediately after setup.

Include a realistic range of dates and transaction types, multiple categories, recurring expenses, income entries, and budget examples.

The demo dataset should be sufficiently varied to demonstrate the charts and filters.

Requirements:

- Mark sample data clearly in the interface.
- Use fictional descriptions and amounts.
- Never imply demo transactions are actual user finances.
- Provide a deterministic seed script.
- Make seeding idempotent or provide a documented reset procedure.
- Do not silently insert demo transactions into a real user's imported dataset.
- Include empty-state examples in the tests even if the main demo has plenty of data.

## 12. Accessibility and Responsive Design

Follow accessible interface practices:

- Use semantic HTML.
- Associate labels with form controls.
- Provide keyboard-accessible dialogs and dropdowns.
- Show visible keyboard focus.
- Use accessible error messages.
- Avoid communicating meaning through color alone.
- Ensure charts have accessible summaries or equivalent data views.
- Respect reduced-motion settings.
- Ensure text and controls remain usable on mobile screens.

Test at representative mobile, tablet, and desktop widths.

## 13. Testing Requirements

Testing is part of the implementation, not an optional final step.

### Unit tests

Test:

- Monetary and analytics utilities.
- CSV parsing and mapping.
- Date normalization.
- Validation behavior.
- Duplicate detection.
- Category suggestion rules.
- Budget calculations.
- Financial summary calculations.

### API integration tests

Test:

- CRUD operations.
- Invalid request handling.
- Filtering and pagination.
- Import preview.
- Valid imports.
- Invalid CSV rows.
- Duplicate handling.
- Category assignment.
- Budget calculations.
- Analytics endpoints.
- Missing records.
- Database errors and transaction rollback where practical.

Use an isolated test database or an appropriate test database strategy. Never run destructive tests against a production database.

### Frontend tests

Test:

- Dashboard loading and error states.
- Date range changes.
- Transaction filters.
- Transaction forms.
- CSV column mapping.
- Import validation feedback.
- Import confirmation and summary.
- Budget forms and progress indicators.
- Theme and settings behavior.

### End-to-end tests

Where the environment supports it, use Playwright to test a realistic flow:

1. Start the application.
2. Open the dashboard.
3. Navigate to transactions.
4. Import a valid CSV.
5. Review validation feedback.
6. Confirm the import.
7. Verify that imported transactions appear.
8. Verify that dashboard metrics update.
9. Create or update a budget.
10. Confirm the resulting budget progress.

Include at least one invalid CSV scenario.

If a database, browser, or external dependency prevents a test from running, explain exactly what was blocked. Do not claim that an unexecuted test passed.

## 14. Developer Experience

Provide root-level commands where practical, such as:

- `npm run dev`
- `npm run build`
- `npm run test`
- `npm run test:watch`
- `npm run lint`
- `npm run typecheck`
- `npm run db:migrate`
- `npm run db:seed`

Use npm workspaces if appropriate. Keep commands consistent with the actual scripts in the repository.

Provide documentation covering:

- Prerequisites.
- Node.js and package-manager versions.
- PostgreSQL setup.
- Environment variables.
- Database creation and migrations.
- Demo-data seeding.
- Starting frontend and backend.
- Running tests.
- Building for production.
- CSV format and supported import assumptions.
- Known limitations.
- Security and deployment considerations.

Document any required local services honestly.

## 15. Implementation Phases

Work through these phases in order.

### Phase 1 — Inspect and plan

- Inspect the repository and installed tooling.
- Check whether any files already exist.
- Review existing code before replacing anything.
- Identify technical risks and decide on the architecture.
- Write a concise implementation checklist.

Do not overwrite useful work simply because a different structure is preferred.

### Phase 2 — Project foundation

- Configure the monorepo and scripts.
- Set up frontend and backend TypeScript.
- Configure linting, formatting, and testing.
- Set up Prisma and PostgreSQL.
- Create environment examples.
- Implement health checks.
- Verify the basic applications start.

### Phase 3 — Database and core API

- Implement schema and migrations.
- Implement seed data.
- Build transaction, category, budget, and settings services.
- Implement request validation and error handling.
- Add API integration tests.

### Phase 4 — UI foundation

- Build the design system and application shell.
- Implement responsive navigation.
- Create loading, error, and empty states.
- Implement theme support.
- Establish reusable table, chart, form, and dialog components.

### Phase 5 — Transactions and CSV imports

- Implement transaction CRUD.
- Build the CSV wizard.
- Implement validation, mapping, categorization suggestions, and duplicate detection.
- Implement safe imports and import history.
- Test import edge cases.

### Phase 6 — Dashboard and analytics

- Implement backend aggregates.
- Build dashboard cards and charts.
- Add date filtering and period comparisons.
- Verify that displayed totals reconcile with transaction data.

### Phase 7 — Budgets, categories, and settings

- Complete budget management.
- Complete category management.
- Implement currency display and theme preferences.
- Implement demo-data reset with confirmation.

### Phase 8 — Testing and hardening

- Run all available automated tests.
- Fix failures and rerun affected tests.
- Check accessibility and responsive layouts.
- Review security and data integrity.
- Check duplicate imports and financial precision.
- Run linting, type checking, and production builds.

### Phase 9 — Documentation and handoff

- Finish the README.
- Document setup and environment variables.
- Document limitations and security requirements.
- Summarize implementation and testing results.
- List anything unfinished honestly.

Do not mark a phase complete until its meaningful deliverables have been implemented and checked.

## 16. Acceptance Criteria

The project is complete when:

- The frontend and backend run using documented commands.
- The PostgreSQL schema and migrations work.
- Demo data can be seeded predictably.
- Transactions can be created, viewed, edited, filtered, and deleted.
- A user can upload a CSV, map its columns, review validation errors, and import valid transactions.
- Repeated imports do not silently create avoidable duplicates.
- Imported transactions persist in the database.
- Dashboard metrics and charts reflect actual database contents.
- Date filters apply consistently.
- Category and budget management work.
- Financial calculations pass relevant automated tests.
- Responsive layouts and accessible controls are implemented.
- Error, loading, and empty states are handled.
- Tests, type checks, linting, and production builds have been run where available.
- Setup documentation is accurate.
- Known limitations and unexecuted checks are explicitly reported.

## 17. Engineering Rules

- Do not build the entire application as one giant component.
- Do not put all backend logic inside route handlers.
- Do not use fake dashboard numbers after real data integration.
- Do not create placeholder buttons that appear functional but do nothing.
- Do not swallow errors or silently discard imported rows.
- Do not bypass TypeScript with `any` or disable strict checking merely to make the build pass.
- Do not suppress tests or weaken assertions just to get a green result.
- Do not add unnecessary dependencies.
- Do not invent external API integrations.
- Do not expose private financial information in logs.
- Do not claim that a feature, test, or build works without verifying it.
- Do not replace existing user files without inspecting them first.
- Prefer small, understandable modules and explicit business rules.
- When a requirement is ambiguous, make a sensible, documented decision and continue rather than stopping for minor questions.
- If a major blocker genuinely prevents progress, explain it and offer the safest practical alternative.

## 18. Final Report

When implementation is complete, provide a concise but specific report containing:

1. Features implemented.
2. Architecture and important design decisions.
3. Database and migration status.
4. Commands for running the application.
5. Environment variables that must be configured.
6. Tests actually executed and their results.
7. Type-checking, lint, and production-build results.
8. Any tests that could not run and the reason.
9. Known bugs, security limitations, and incomplete features.
10. A sensible list of next improvements.

Begin by inspecting the repository and then continue through implementation. The goal is a working, tested, documented application—not just a plan, mockup, or partial scaffold.