# Research Analyser

A Next.js research workflow tool for turning UserTesting studies into transcript-grounded UX research analysis and reports.

The app helps researchers create a project, add a research script, import or paste transcripts, generate per-question analysis with GPT-5.5, and turn that evidence into a final report.

## What It Does

- Creates research projects for unmoderated, moderated, and balanced comparison studies.
- Stores projects, transcripts, analysis runs, findings, and report versions in Supabase.
- Imports UserTesting transcripts through a local Playwright-assisted workflow.
- Generates per-question, per-user analysis grounded in the study script and transcripts.
- Produces editable final reports and supports project-level research chat.

## Tech Stack

- Next.js 16 and React 19
- TypeScript
- Supabase
- OpenAI Responses API
- Tailwind CSS and Radix UI primitives

## Getting Started

Install dependencies:

```bash
npm install
```

Create local environment variables:

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
OPENAI_API_KEY=sk-...
```

Run the local app:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase publishable key for browser-safe requests. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase secret key for server-side imports, scripts, and privileged writes. |
| `OPENAI_API_KEY` | Yes | Enables analysis generation, report regeneration, and project chat. |
| `SUPABASE_URL` | No | Compatibility alias for scripts. |
| `SUPABASE_ANON_KEY` | No | Compatibility alias for scripts. |
| `POSTGRES_URL` | No | Useful for external database tooling; not read by the app directly. |

Never commit `.env.local` or any real secret values.

## Supabase Setup

The database schema lives in `scripts/*.sql` and `supabase/migrations/`.

For a fresh Supabase project:

1. Create or link a Supabase project.
2. Apply the SQL in `scripts/setup.sql`, or apply the numbered SQL files in order.
3. Add the Supabase URL, publishable key, and secret key to `.env.local`.
4. Start the app with `npm run dev`.

See `SUPABASE_SETUP.md` for more detail.

## Useful Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run import-usertesting
npm run inspect-project
```

Local analysis and inspection helpers:

```bash
node scripts/run_local_analysis.js --project-id <uuid> --analysis-run-id <uuid> --app-url http://localhost:3000
node scripts/inspect_project_state.js --project-id <uuid>
```

For the hosted Sites deployment, Supabase-backed browsing and manual transcript
entry work in the web app, but the long-running helper tasks still run from a
local machine:

```bash
npm run import-usertesting -- --project-id <uuid> --app-url https://researchanalyser.moonpig.chatgpt-team.site
node scripts/run_local_analysis.js --project-id <uuid> --analysis-run-id <uuid> --app-url https://researchanalyser.moonpig.chatgpt-team.site
```

The hosted app will fail fast with those instructions instead of leaving import
or analysis runs permanently queued.

## Repository Notes

- `.env.example` is the safe template for local configuration.
- `.env.local` is ignored and should contain real local secrets.
- Supabase CLI cache files under `supabase/.temp/` are ignored.
- UserTesting bulk transcript exports are ignored by default under `Bulk import/`.
