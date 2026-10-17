# SpendScope — Production Readiness, Security Hardening, Final Audit & Deployment

## 1. Your role and mission

Act as a senior full-stack engineer, application security engineer, database engineer, QA engineer, DevOps engineer, and technical lead.

The existing SpendScope application has already been implemented to some degree. Your task is to take the **actual existing application** from its current state to a reliable, secure, tested, documented, production-ready deployment.

This is not a greenfield rewrite.

Your responsibilities are to:

1. Audit the current repository and running implementation.
2. Compare it against `OPENCODE_SPEC.md` and the requirements in this document.
3. Identify and fix implementation gaps, defects, security risks, and deployment blockers.
4. Implement the listed improvements where appropriate.
5. Verify the application with actual tests and production builds.
6. Configure CI and production deployment.
7. Deploy the application when the required credentials, permissions, configuration, and verification gates are available.
8. Provide a factual final audit and deployment handoff.

Do not stop after planning, producing a checklist, or writing documentation. Continue implementing and verifying the work.

Do not assume previous reports are accurate. Inspect source code, configuration, database migrations, tests, Git status, and the actual behavior of the application.

## 2. Authoritative specifications

Read these files before making changes:

- `OPENCODE_SPEC.md`
- `PRODUCTION_READINESS.md`
- `README.md`
- Existing agent instructions and project-specific documentation, if present.

Inspect the repository structure, package scripts, dependency versions, environment configuration, database schema, migrations, existing tests, and deployment files.

Treat the existing code as the source of truth for what has actually been implemented.

Preserve working functionality and existing user data. Do not rewrite the project merely to match your preferred architecture.

If the current implementation conflicts with the specifications, document the discrepancy and implement the safest reasonable correction.

## 3. Phase One — Baseline audit

Before modifying anything:

- Inspect Git status and preserve existing uncommitted work.
- Identify the frontend, backend, database, shared packages, and test suites.
- Check the Node.js, package-manager, TypeScript, Prisma, and PostgreSQL compatibility requirements.
- Review existing dependencies for known risks using available tools.
- Inspect authentication, authorization, session management, input validation, and database access.
- Trace the transaction import process from CSV upload to persistent database records.
- Trace dashboard values from database queries through API responses to rendered charts.
- Review financial calculation utilities and transaction-type conventions.
- Inspect database indexes, constraints, deletion behavior, and migrations.
- Identify current deployment assumptions and any development-only behavior.
- Run existing tests and checks before changing the implementation, when the environment permits.

Create `docs/PRODUCTION_READINESS_AUDIT.md` containing:

- Current implementation status.
- Baseline test results.
- Identified defects and security risks.
- Missing infrastructure or credentials.
- Recommended deployment architecture.
- Prioritized implementation plan.

Classify findings as critical, high, medium, or low priority.

Do not expose real secrets, credentials, or financial records in the audit report.

## 4. Phase Two — Complete the application against its original specification

Audit every applicable requirement in `OPENCODE_SPEC.md`.

### Transactions

Verify that transaction creation, reading, updating, deletion, filtering, pagination, sorting, searching, category assignment, and review status work correctly.

Verify that deleted or modified transactions correctly affect dashboard metrics, category totals, and budget progress.

### CSV import

Verify the complete import workflow:

- File validation and size limits.
- CSV parsing, including quoted fields and embedded commas.
- Column mapping and preview.
- Date and amount validation.
- Row-level error reporting.
- Categorization suggestions.
- Duplicate detection.
- Safe database writes.
- Idempotency and repeated submissions.
- Import history and accurate result counts.

Do not silently discard failed rows. Do not report an import as successful if the database transaction failed.

Test concurrent or repeated import requests where practical. Ensure a retry cannot unintentionally duplicate already imported transactions.

### Analytics and financial calculations

Verify that dashboard metrics and charts use real API/database data rather than development fixtures or hardcoded values.

Audit:

- Income and expense totals.
- Net cash flow.
- Savings rate.
- Category spending.
- Budget progress.
- Monthly trends.
- Date-range boundaries.
- Previous-period comparisons.
- Refunds, transfers, and adjustments if supported.
- Decimal precision and rounding.
- Zero-income and empty-data cases.

Use decimal-safe arithmetic for financial values. Never use floating-point calculations as the authoritative source of financial totals.

Define consistent rules for refunds and transfers. If exact refund linkage or account-level transfer matching is not implemented, make that limitation explicit and do not claim those transactions are classified perfectly.

### Categories, budgets, settings, and demo data

Verify category CRUD, category reassignment, budget creation and editing, currency display, theme persistence, date preferences, and demo-data reset.

Ensure demo data is distinguishable from real imported data and cannot be silently mixed into a real workspace.

Check that seed scripts are safe to rerun and do not overwrite real user data.

## 5. Phase Three — Authentication and workspace isolation

Implement secure authentication and bind financial records to the authenticated user's workspace.

Authentication is a production blocker for a publicly accessible, multi-user financial application.

Use an established authentication solution compatible with the current stack when practical. Do not invent cryptography or implement a fragile home-grown session mechanism.

Requirements:

- Secure registration or an appropriately controlled account-provisioning process.
- Secure login and logout.
- Proper session expiration and invalidation.
- Secure password hashing if passwords are managed locally.
- Secure password reset and email verification if those features are supported by the chosen authentication model.
- Rate limiting on authentication endpoints.
- Protection against brute-force login attempts.
- Secure cookie settings when cookie-based sessions are used.
- Appropriate CSRF protection for cookie-authenticated state-changing requests.
- Appropriate CORS restrictions.
- Authorization checks on every protected API operation.
- User and workspace ownership enforcement in database queries and mutations.
- Isolation of transactions, imports, categories, budgets, settings, exports, and analytics between users.
- No exposure of another user's records by guessing or changing record IDs.
- Safe handling of account deletion and data retention.

Do not rely on frontend route guards as a security boundary. Authorization must be enforced by the backend.

Create tests that prove User A cannot read, update, delete, export, or derive analytics from User B's data, including through nested resources and import endpoints.

If authentication requires an external provider, email service, or secret that is not configured, implement the compatible integration and clearly report what remains blocked. Do not bypass authentication to make deployment easier.

## 6. Phase Four — Refunds, recurring transactions, transfers, and category rules

Address the following improvements from the existing project handoff.

### A. Refund handling

Where feasible, support explicit linkage between a refund and its original expense.

- Store a reference to the original transaction when known.
- Validate that the referenced transaction is eligible and belongs to the same workspace.
- Prevent a refund from being linked to a transaction in another workspace.
- Define how partial and multiple refunds affect analytics.
- Avoid counting a refund as ordinary income when the product's accounting rules treat it as a reduction of expense.
- Document the treatment of refunds that cannot be matched.

If automatic matching is introduced, label it as a suggestion and allow review. Never claim a match is certain when it is inferred.

### B. Recurring transaction detection

Add an explainable recurring-transaction detection feature.

- Identify likely recurring descriptions and intervals.
- Support common weekly, monthly, and annual patterns where data permits.
- Provide confidence or explanatory reasons.
- Let users review or dismiss suggestions.
- Avoid generating duplicate transactions automatically.
- Add subscription-related summaries only when supported by actual evidence.

Do not claim that a merchant is a subscription solely because its name appears more than once.

### C. Account-to-account transfer matching

If account-level transaction data is available, support suggested matching of two sides of a transfer.

- Require compatible dates, amounts, and other available evidence.
- Allow reasonable date offsets for settlement timing.
- Require user confirmation for uncertain matches.
- Avoid double-counting matched transfers as income and expenses.
- Keep unmatched transactions visible.
- Ensure both sides belong to the same workspace.

If the current data model does not support identifying accounts, implement the necessary model changes or document the minimum supported transfer behavior rather than pretending matching is possible.

### D. Configurable category rules

Allow users to configure rules such as normalized merchant or description keyword → category.

- Rules must belong to a workspace.
- Validate rule content.
- Define deterministic rule ordering and conflict resolution.
- Allow rules to be enabled, disabled, edited, and deleted.
- Apply rules to future imports.
- Make retroactive recategorization an explicit user action.
- Preserve manual category overrides unless the user chooses otherwise.
- Test overlapping rules and case-insensitive matching.

## 7. Phase Five — CSV export, backups, and import recovery

### CSV export

Implement secure transaction export for the authenticated workspace.

- Support relevant date, category, type, and other filters.
- Escape CSV fields correctly.
- Protect spreadsheet users against formula injection from untrusted text fields.
- Format dates and decimal amounts consistently.
- Avoid exporting data outside the current user's authorization scope.
- Use appropriate response headers and filenames.
- Test special characters, commas, quotes, newlines, and values beginning with spreadsheet formula characters.

### Workspace backup and restore

Design a reliable export and restore workflow for workspace data.

- Include the supported transactions, categories, budgets, settings, and relevant metadata.
- Use a documented, versioned backup format.
- Validate backups before restoring.
- Reject malformed or unsupported backup versions safely.
- Prevent backup restoration from crossing workspace boundaries.
- Define how IDs and relationships are reconciled.
- Prevent accidental duplication when restoring into an existing workspace.
- Require explicit confirmation before destructive replacement or reset.
- Avoid exposing backups through public, guessable URLs.
- Do not include credentials, password hashes, session tokens, or secrets in user-facing backups.
- Document the distinction between a user-level workspace export and a full database disaster-recovery backup.

Test backup creation, validation, restoration, invalid backups, and recovery behavior.

### Import-preview persistence

Address the existing limitation where import previews do not survive an API restart.

Prefer a durable, expiring import-session or staging model.

- Persist enough information to resume the import safely.
- Associate each import session with its owning user/workspace.
- Apply access control to every preview and import operation.
- Expire abandoned sessions and clean up staged data.
- Do not retain raw CSV files indefinitely.
- Validate staged rows again before final persistence.
- Prevent repeated confirmation from duplicating transactions.
- Define behavior for concurrent modifications and expired previews.

If temporary files are necessary, store them outside publicly served directories with restricted permissions and documented cleanup.

## 8. Phase Six — Currency handling

The default currency should remain GHS unless the user changes it.

Audit the existing currency model before adding conversion.

### Requirements

- Clearly distinguish transaction currency, workspace base currency, and display currency.
- Never silently reinterpret an existing amount when a currency preference changes.
- If conversion is implemented, use explicit dated exchange rates from a documented source.
- Persist the applicable rate, rate date, source, and conversion metadata needed to reproduce results.
- Handle missing rates and non-business days explicitly.
- Define how rounding works.
- Keep original amounts available.
- Make currency conversion opt-in.
- Do not invent exchange rates or use a hardcoded rate while claiming it is current.
- Do not make external API calls for exchange rates unless an approved provider is configured.

Add tests for conversion arithmetic, missing rates, rounding, and historical reproducibility.

If a reliable rate source cannot be configured, complete the currency model and user interface safely but leave conversion disabled and report the dependency. Do not block a correctly documented single-currency deployment solely because optional conversion is unavailable.

## 9. Phase Seven — Optional zero-server installation

Evaluate the proposal to support SQLite or IndexedDB for a local, zero-server installation.

This is an optional deployment target, not a reason to destabilize the production PostgreSQL application.

First determine whether the existing architecture can support a local mode without compromising data integrity, authentication assumptions, or test coverage.

If feasible within the current architecture:

- Define a separate, explicit local mode.
- Choose SQLite for a persistent local database or IndexedDB for a browser-only experience based on actual requirements.
- Keep database-specific behavior isolated.
- Define migrations, backup, and restore behavior.
- Make it impossible to confuse local data with server workspace data.
- Test the local mode independently.

If implementing both database modes would require a major rewrite, document the architecture, trade-offs, and migration plan. Do not introduce an untested storage abstraction or claim local mode is supported when it is not.

## 10. Phase Eight — Security hardening

Perform a security review of the actual code and configuration.

### Secrets and configuration

- Remove secrets from tracked files and logs.
- Provide complete `.env.example` documentation with placeholders only.
- Validate required production environment variables at startup.
- Fail safely when critical configuration is missing.
- Separate development, test, and production configurations.
- Rotate any real credentials discovered in tracked files; never reproduce them in reports.
- Ensure environment files and local database files are covered by `.gitignore` where appropriate.

### API security

- Apply authentication and authorization consistently.
- Validate request bodies, query parameters, path parameters, uploaded files, and restored backups.
- Configure CORS for known production origins.
- Add appropriate security headers.
- Apply sensible request-size limits.
- Rate-limit sensitive and expensive endpoints.
- Avoid leaking stack traces, SQL details, credentials, or internal errors.
- Ensure logs contain enough operational context without unnecessary personal financial information.
- Review file parsing and CSV export for injection risks.
- Review dependencies for vulnerabilities and explain any accepted exceptions.

### Data protection

- Require HTTPS for production traffic.
- Use managed secret storage or the deployment platform's protected environment variables.
- Restrict production database access.
- Use least-privilege database credentials.
- Define backup retention and deletion policies.
- Document what personal data is stored and why.
- Avoid sending financial records to third-party analytics or AI services.
- Provide a clear account-data export and deletion strategy.

Do not claim that the application is compliant with a law, certification, or security standard without evidence and an appropriate assessment.

## 11. Phase Nine — Production database reliability

Review PostgreSQL schema and operations.

- Verify production migrations can be applied from a clean database.
- Verify existing databases can be upgraded safely.
- Inspect foreign keys, uniqueness constraints, indexes, and deletion behavior.
- Add indexes for demonstrated query patterns where useful.
- Avoid destructive production migrations.
- Separate schema migration from demo-data seeding.
- Never run destructive seed or reset commands against production.
- Use transactions for related writes.
- Ensure failed imports roll back appropriately.
- Configure connection pooling or connection limits suitable for the deployment platform.
- Verify database timeouts and failure handling.
- Document migration, rollback, and recovery procedures.

Test migrations in an isolated environment. Do not experiment against a live production database.

### Backups and recovery

Configure automated database backups using a supported managed-database feature or a documented equivalent.

Document:

- Backup frequency.
- Retention.
- Access controls.
- Encryption where supported.
- Recovery procedure.
- Expected recovery point and recovery time objectives, if established.

Where possible, perform a restore drill in a separate test environment. A backup configuration is not proof that restoration works.

Do not delete or overwrite production data to test recovery.

## 12. Phase Ten — Performance and observability

Prepare the application for normal production operations.

- Use pagination for potentially large transaction datasets.
- Ensure analytics use appropriate database aggregation and query patterns.
- Avoid loading all transactions for every dashboard request.
- Identify N+1 query patterns.
- Review large CSV import memory usage and batch writes.
- Use reasonable request timeouts.
- Provide health and readiness checks.
- Distinguish application health from database readiness.
- Add structured server logs.
- Provide request correlation identifiers where practical.
- Record errors and operational events without logging sensitive financial payloads.
- Configure error monitoring if a suitable provider is available and approved.
- Avoid tracking user financial data in third-party telemetry.

Run practical load or performance checks if the environment permits. State the workload and limitations; do not make unsupported performance guarantees.

## 13. Phase Eleven — Automated testing and CI

Configure continuous integration using GitHub Actions if the repository is hosted on GitHub, or an equivalent supported CI system.

The CI pipeline must run:

1. Dependency installation using the repository's committed lockfile.
2. Formatting or lint checks.
3. TypeScript type checks.
4. Unit tests.
5. Frontend and backend integration tests.
6. Production builds.
7. Database migration checks against an isolated test database where practical.
8. End-to-end tests where the CI environment supports the required services.

Use a dedicated test database and isolated test credentials. Never run destructive test scripts against production.

Add tests for the security and reliability changes, especially:

- Cross-workspace data access prevention.
- Authentication and authorization.
- Repeated imports.
- Concurrent import requests.
- Refund behavior.
- Transfer handling.
- Category rule conflicts.
- CSV formula injection.
- Backup and restore validation.
- Currency conversion.
- Expired import sessions.
- Date and decimal boundaries.
- Production configuration validation.

Do not weaken tests, remove assertions, skip failing suites without explanation, or substitute mocked responses for tests that are supposed to verify real database behavior.

CI should fail when required checks fail.

Do not expose production secrets in workflow files or build logs.

## 14. Phase Twelve — Deployment architecture and execution

Inspect the current application and select the simplest reliable deployment architecture compatible with its real needs.

Evaluate supported options such as:

- A platform that can host the frontend, backend, and managed PostgreSQL.
- A separate static frontend deployment and backend application with managed PostgreSQL.
- Another existing deployment target already used by the repository.

Choose based on the actual monorepo structure, runtime requirements, file handling, database connectivity, persistent storage needs, background tasks, and available platform support.

Do not choose a provider solely because it is familiar.

Before deploying, document the selected architecture in `docs/DEPLOYMENT.md`, including:

- Frontend and backend hosting.
- Database hosting.
- Production URLs and routing.
- Environment variables.
- Authentication callback URLs, if relevant.
- CORS configuration.
- Database migration procedure.
- Health checks.
- Build and start commands.
- Backup and restore procedures.
- Rollback procedure.
- Expected service limitations and costs, where known.

### Production configuration

Ensure:

- The production frontend calls the correct backend URL.
- The backend uses the correct production database.
- HTTPS is enforced.
- CORS allows only intended production origins.
- Cookies and authentication callbacks use the correct secure configuration.
- The application has no hardcoded localhost production URLs.
- Debug endpoints and development tools are not exposed.
- Demo data is not inserted automatically into a real production workspace.
- The production build contains no development-only secrets.
- The health and readiness endpoints behave as documented.

### Deployment safeguards

You may inspect platform documentation, prepare deployment files, run local checks, and use configured deployment integrations.

However:

- Do not invent credentials or pretend an account is connected.
- Do not expose secrets in chat or repository files.
- Do not purchase a domain, activate a paid service, upgrade a plan, or incur new charges without explicit user authorization.
- Do not delete or overwrite an existing production service.
- Do not run destructive migrations or reset a live database.
- Do not migrate real user data without a verified backup and explicit authorization.
- Do not switch DNS or redirect production traffic without explicit authorization.
- If credentials or permissions are missing, finish all work possible locally and provide exact remaining steps.
- If deployment requires a decision that has financial or irreversible consequences, explain the choice and request approval before proceeding.

Do not report a deployment as complete until the platform confirms it and the deployed application has been tested through its public production endpoints.

## 15. Phase Thirteen — End-to-end production smoke test

After deployment, use the actual deployed URLs and a safe test account.

Verify:

- The frontend loads over HTTPS.
- The API health endpoint responds correctly.
- Database connectivity and readiness work.
- Registration/login/logout work as configured.
- Protected endpoints reject unauthenticated access.
- Two separate test users cannot access each other's records.
- A transaction can be created, updated, filtered, and deleted.
- A valid CSV can be imported.
- An invalid CSV produces understandable validation errors.
- Repeating an import does not create avoidable duplicates.
- Dashboard figures reflect persisted database data.
- Budgets and category totals update correctly.
- CSV exports contain only authorized data.
- Backup export and restore work in a safe test environment.
- Application logs do not leak financial records or secrets.
- Expected errors are handled gracefully.
- Production assets and routes work after refresh.
- The deployment remains functional after an application restart, where practical.

Use test records only. Do not upload real personal financial data into deployment smoke tests.

If the deployed service is publicly accessible, verify that the application does not expose sensitive data before sharing its URL.

## 16. Phase Fourteen — Final engineering audit

Perform a final engineering audit of SpendScope against every requirement in `OPENCODE_SPEC.md`, this document, and the original implementation.

Inspect the actual implementation, not just the README or your previous summary.

Verify at least:

- Transaction CRUD and query filtering.
- CSV parsing, column mapping, validation, duplicate handling, and import persistence.
- Dashboard metrics and charts use real backend data.
- Financial calculations, decimal precision, date boundaries, and budget calculations.
- Category and budget management.
- Database migrations and seed behavior.
- Authentication and workspace isolation.
- Refund and transfer handling.
- Recurring transaction detection.
- Configurable category rules.
- CSV export and backup/restore.
- Import-preview persistence and expiration.
- Currency handling and conversion limitations.
- Error handling and environment configuration.
- Data privacy and security.
- Automated tests and CI.
- Production build and deployment configuration.
- Actual deployed application behavior, if deployment was completed.

Run available unit, frontend, API integration, database, and end-to-end tests.

Run type checks, lint checks, dependency/security checks, and production builds.

Fix defects discovered and rerun the relevant checks.

Do not weaken tests, remove requirements, or replace failing functionality with mock data merely to obtain passing checks.

### Mandatory audit statuses

Assign each requirement one of the following statuses:

- **PASS:** Implemented and verified with concrete evidence.
- **FAIL:** Attempted verification demonstrated a defect or incorrect behavior.
- **BLOCKED:** Verification or implementation could not proceed because of a specific external dependency, missing permission, unavailable service, or infrastructure constraint.
- **NOT IMPLEMENTED:** The required feature or control is missing.

Do not use PASS because code merely exists. Verify the behavior.

Include:

- Requirement identifier and description.
- Status.
- Evidence or file locations.
- Exact test or command executed.
- Actual result.
- Remaining issue or remediation, where applicable.

Distinguish a test failure from a test that could not run. Do not report blocked checks as passed.

### Release gate

Do not describe SpendScope as production-ready if a critical security, data integrity, authentication, migration, or financial calculation issue remains unresolved.

If a requirement is noncritical and intentionally deferred, identify it explicitly and explain the impact.

## 17. Required deliverables

Maintain the following project artifacts:

- `docs/PRODUCTION_READINESS_AUDIT.md`
- `docs/DEPLOYMENT.md`
- `docs/SECURITY.md`
- `docs/DATA_BACKUP_AND_RESTORE.md`
- `docs/PRODUCTION_TEST_REPORT.md`
- CI workflow configuration
- Updated `README.md`
- Updated `.env.example`
- Relevant tests and migration files
- A deployment checklist and rollback procedure

Create a progress log if the work spans multiple sessions. Record completed phases, files changed, commands run, actual outcomes, remaining blockers, and the next recommended action.

Do not place secret values, private customer data, or raw financial records in these documents.

## 18. Final report

At the end, provide a concise but evidence-based handoff containing:

1. What was already working at the beginning.
2. What you implemented or repaired.
3. Security improvements and remaining risks.
4. Database migration and backup status.
5. CI configuration and actual run results.
6. Tests executed, with exact commands and pass/fail counts where available.
7. Type-checking, linting, dependency audit, and build results.
8. Which requirements are PASS, FAIL, BLOCKED, or NOT IMPLEMENTED.
9. Deployment provider and architecture selected.
10. The actual production URL, only if deployment was verified.
11. Smoke-test results from the deployed application.
12. Required environment variables, without revealing their values.
13. Any remaining manual steps requiring the user's action.
14. Known limitations and deferred improvements.
15. Rollback and recovery instructions.

Do not claim that SpendScope is fully production-ready or deployed if the evidence does not support that conclusion.

Begin with the baseline audit. Continue through implementation, testing, and deployment as far as the available environment and authorized permissions allow.