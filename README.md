# The Ledger — Financial Planner

A long-range financial scenario planner built in React/Vite. Models Australian + Singapore tax, super contributions with caps, property loans (P&I, IO with conversion, offset, negative gearing, investment deductibility), CGT, franking credits, retirement, inflation toggle, and more.

## Quick start (local development)

You need **Node.js 18+** installed ([download from nodejs.org](https://nodejs.org)).

```bash
# 1. Install dependencies (~30–90 seconds)
npm install

# 2. (Optional) Set up Supabase auth and cloud sync
cp .env.example .env
# Then edit .env and paste your Supabase URL + publishable key

# 3. Start the dev server
npm run dev
```

Browser opens to `http://localhost:5173`. Press `Ctrl+C` in Terminal to stop.

## Daily use

```bash
cd path/to/financial-planner-pkg
npm run dev
```

## Modes

The app runs in one of two modes depending on whether `.env` is configured:

### Without Supabase (localStorage-only)
- Skip the `.env` step
- No login screen — app loads straight to the planner
- Scenarios saved to your browser's localStorage, scoped to whichever URL you're on
- Each browser/device is its own data silo
- Use **Save As** / **Load** buttons to export/import `.json` backups

### With Supabase (cloud sync)
- Create `.env` with your Supabase URL and publishable key
- Login screen on first visit; create an account or sign in
- Scenarios sync to Supabase automatically (debounced ~800ms after each edit)
- Sign in on any device with the same email/password to see the same data
- Sync indicator (top right): green "Synced" / yellow "Saving…" / red "Save failed"
- LocalStorage acts as a fallback cache; if you're offline, edits are kept locally and synced when connection returns

## Setting up Supabase (cloud sync)

If you want cloud sync across devices:

1. Sign up at [supabase.com](https://supabase.com), create a new project (free tier works fine)
2. In **SQL Editor**, run this script to create the scenarios table:

```sql
create table public.scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index scenarios_user_id_idx on public.scenarios(user_id);

alter table public.scenarios enable row level security;

create policy "users read own scenarios"
  on public.scenarios for select to authenticated using (auth.uid() = user_id);
create policy "users insert own scenarios"
  on public.scenarios for insert to authenticated with check (auth.uid() = user_id);
create policy "users update own scenarios"
  on public.scenarios for update to authenticated using (auth.uid() = user_id);
create policy "users delete own scenarios"
  on public.scenarios for delete to authenticated using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger scenarios_updated_at
  before update on public.scenarios
  for each row execute function public.set_updated_at();
```

3. In **Authentication → Providers → Email**, decide whether to enable signups (default on) and email confirmation (recommended on)
4. In **Project Settings → API**, copy your Project URL and Publishable key
5. Paste them into `.env`:

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_KEY=sb_publishable_your_key
```

6. Restart `npm run dev` (Vite reads `.env` only on startup)

## Deploying to Vercel

The app is a static SPA, so Vercel's free tier covers it.

1. Push this folder to a GitHub repository
2. Import the repo in Vercel — it auto-detects Vite
3. In Vercel **Project Settings → Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (tick all three environments — Production, Preview, Development)
4. Trigger a redeploy if needed
5. (Optional but recommended) In Supabase **Authentication → URL Configuration**, set **Site URL** to your Vercel URL so password-reset emails redirect correctly

## Where data lives

| Mode | Data location | Cross-device? |
|---|---|---|
| Local-only (no Supabase) | Browser localStorage at this URL | No |
| Cloud sync (Supabase) | Supabase Postgres + localStorage cache | Yes (sign in everywhere) |
| Save As button | Real `.json` file you choose where to save | Manual |

If clearing browser data, use **Save As** first to back up. With Supabase configured, the cloud is the source of truth.

## Features overview

- **Three tabs**: Planner (chart + inputs), Logic (visual flow + formula cards), Trace (line-by-line year calculation)
- **Multiple scenarios** with rename and fork
- **Two-earner model** with separate currencies (AUD / SGD), tax modes, super rates
- **Dark editorial design** — EB Garamond + JetBrains Mono + Inter Tight, recharts, lucide-react

## Project structure

```
financial-planner-pkg/
├── src/
│   ├── App.jsx          # The whole application (one file, ~3400 lines)
│   └── main.jsx         # React entry point
├── index.html           # HTML shell with fonts
├── package.json         # Dependencies
├── vite.config.js       # Dev server config
├── .env.example         # Template — copy to .env and fill in
├── .gitignore           # Ignores node_modules, .env, etc.
└── README.md            # This file
```

## Requirements

- Node.js 18+
- macOS, Linux, or Windows
- Modern browser (Chrome, Safari, Firefox, Edge — recent versions)
