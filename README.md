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
  version integer not null default 0,
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
- **Retirement drawdown** — cash shortfalls are funded by selling other cash, then shares, then super (once past the super access age); configurable under Assumptions
- **Dark editorial design** — EB Garamond + JetBrains Mono + Inter Tight, recharts, lucide-react

## Project structure

```
financial-planner-pkg/
├── src/
│   ├── App.jsx          # Main component — charts, state management, layout
│   ├── engine.js        # Pure projection engine — tax, super, loans, migration (no React)
│   ├── engine.test.js   # Engine regression tests (Vitest)
│   ├── storage.js       # Persistence — Supabase, localStorage, file save/load
│   ├── theme.js         # Design tokens, category metadata, formatters, shared styles
│   ├── components/      # Row editors, fields, tooltips, Logic/Trace tabs, auth screen
│   ├── ErrorBoundary.jsx# Top-level error boundary
│   └── main.jsx         # React entry point
├── index.html           # HTML shell with fonts
├── package.json         # Dependencies (app version lives here too)
├── vite.config.js       # Dev server config
├── .env.example         # Template — copy to .env and fill in
├── .gitignore           # Ignores node_modules, .env, etc.
└── README.md            # This file
```

## Tests

The projection engine (tax brackets, Medicare levy + surcharge, super caps, Div 293,
loan amortisation, scenario migration, retirement drawdown) is covered by unit tests:

```bash
npm test
```

## Running on iPad / iPhone (native, via Capacitor)

The same React code is wrapped as a real iOS app using [Capacitor](https://capacitorjs.com). You'll need macOS + Xcode + an Apple ID.

### One-time setup

1. Install Xcode from the Mac App Store
2. Open Xcode once and accept the license; install any prompted simulator runtimes
3. (Optional, for plugins that need it) Install CocoaPods: `brew install cocoapods`

### Build and open in Xcode

```bash
npm run ios
```

This runs `vite build`, copies the bundle into `ios/App/App/public/`, and opens the Xcode project. Then in Xcode:

1. Select a simulator (e.g. "iPhone 16 Pro") or a connected device from the run-target dropdown
2. Click the **Run** button (▶) or press **Cmd-R**
3. First build downloads simulator runtime if needed; subsequent runs are fast

### Running on a physical iPhone / iPad

1. Connect the device via USB and trust this Mac when prompted
2. In Xcode → **Signing & Capabilities**, sign in with your Apple ID and pick a team (free personal team works)
3. Change the **Bundle Identifier** if `com.benellis.ledger` is already taken on your Apple ID
4. Select the device as the run target and click **Run**
5. On first launch, the iPhone will refuse to open the app — go to **Settings → General → VPN & Device Management** on the iPhone and trust the developer profile

### Daily workflow

After editing React code:

```bash
npm run ios:sync    # rebuild + copy into iOS without opening Xcode
```

Then in Xcode just hit **Run** again. Or use the all-in-one:

```bash
npm run ios         # build + sync + open Xcode
```

### Supabase auth caveat

Email confirmation links from Supabase redirect to your project's **Site URL** (set in Supabase dashboard). In the native iOS app that means the link opens Safari, not the app. After confirming in Safari, switch back to the app and sign in — the session is then stored locally in the WebView.

For a true deep-link redirect (`yourapp://`) back to the native app, add `@capacitor/app` URL listeners and configure a custom URL scheme in `ios/App/App/Info.plist`. Not required for basic usage.

## Requirements

- Node.js 18+
- macOS, Linux, or Windows (iOS build requires macOS + Xcode)
- Modern browser (Chrome, Safari, Firefox, Edge — recent versions)
