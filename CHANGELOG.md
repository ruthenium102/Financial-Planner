# Changelog

All notable changes to The Ledger are recorded here. Each entry corresponds to a deployment.

---

## v1.16 — 5 July 2026

**Scenario deletion now asks for confirmation.** Deleting a scenario is permanent (it
removes the cloud row too), but a single click on the × used to do it instantly. It now
shows a confirmation modal with a red Delete button and a toast on completion.

**Phone-friendly layout.** Below 900px the planner stacks the chart above the input
panels instead of crushing them into a 400px column — the iOS app and phone browsers
get the full width for editing.

**Component split.** The UI is now organised into modules: `theme.js` (design tokens,
formatters, shared styles) and `src/components/` (rows, fields, tooltips, Logic tab,
Trace tab, auth screen). `App.jsx` shrank from ~3,500 to ~1,500 lines and only holds
the main component. No behaviour change.

---

## v1.15 — 5 July 2026

### Tax fixes

**Medicare Levy Surcharge was one tier too low** — the tier table was off by one band, so
anyone modelled without private health cover paid 0% instead of 1% in tier 1, 1% instead of
1.25% in tier 2, and the top 1.5% rate was unreachable. Now matches ATO 2025–26 thresholds
exactly (covered by unit tests).

**Medicare levy low-income phase-in** — the 2% levy previously kicked in as a cliff at
$27,222. It now shades in at 10c per dollar of the excess, matching the ATO calculation.

**Division 293 no longer double-counts salary sacrifice** — Div-293 income is now computed
as taxable income (+ investment-loss add-back) + concessional contributions, instead of
gross + concessional. Salary-sacrificing near the $250k threshold no longer triggers
Div 293 early.

### Retirement drawdown (new)

Cash shortfalls (typically after retirement) are now funded by selling assets instead of
letting cash go infinitely negative: other cash accounts first, then shares, then super once
the household reaches the super access age (default 60). Configurable under Assumptions
(including off, which restores the old behaviour). Negative cash balances also no longer
compound at the cash growth rate. The wealth-chart tooltip shows how each year's deficit
was funded, and flags any unfunded shortfall.

### Cloud sync fixes

- **Renaming a scenario no longer duplicates it in the cloud.** Previously the rename
  inserted a new row and orphaned the old one, which resurrected the old name on next sign-in.
- Loading scenarios no longer immediately re-saves them (every load used to bump every
  row's version for nothing, inviting conflicts from other open tabs).
- Signing out clears the localStorage cache so financial data doesn't linger on shared machines.
- Scenario rows now save in parallel instead of one at a time.

### Load dialog

Loading a file when scenarios already exist now offers three real choices: **Replace all**,
**Merge in**, and **Cancel**. (Previously "Cancel"/Escape silently merged.)

### Under the hood

- `App.jsx` split into `engine.js` (pure projection/tax engine), `storage.js`
  (Supabase / localStorage / file persistence), and the UI.
- **Unit tests** (Vitest, `npm test`): ATO brackets, Medicare levy + MLS, IRAS brackets,
  Div 293, loan amortisation, scenario migration, drawdown, franking credits.
- Item IDs use `crypto.randomUUID` (no more same-millisecond collisions).
- README setup SQL now includes the `version` column (new installs were broken without it).
- App version derives from `package.json` so the two can't drift.
- Accessibility: pinch-zoom no longer blocked; auth-screen links are real buttons.
- Removed duplicate font loading and dead code; ESLint unused-variable warnings fixed.

---

## v1.13 — 6 May 2026

### ⚠️ Required action: Supabase migration

Before deploying this version, run this SQL in your Supabase SQL Editor (Database → SQL Editor → New query):

```sql
ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS version integer DEFAULT 0;
UPDATE scenarios SET version = 0 WHERE version IS NULL;
```

This adds the `version` column needed for the new optimistic concurrency check. Existing rows are stamped with version 0; new edits will increment from there.

---

**Optimistic concurrency for cloud saves**
- Adds a per-scenario `version` integer in Supabase. Every save sends the version Claude expects to overwrite. If another device or browser tab has already saved a newer version, the database refuses the stale save.
- When this happens, a "Save conflict" modal appears with two options:
  - **Refresh** — discard local changes, reload latest version from cloud
  - **Download backup** — save your current state to a file first, then refresh
- This prevents the failure mode where you edit a scenario on your laptop, then accidentally overwrite those changes from a stale browser tab on another device.

**Load / Save / Save As — file workflow**
- Three new buttons in the header: Load, Save, Save As.
- Default behaviour for new users is unchanged: cloud autosave to Supabase. The file workflow is opt-in.
- **Load**: open a `.json` file from disk. If you have existing scenarios, you'll be prompted to either replace them or merge incoming scenarios alongside your current ones (with name collisions getting "(imported)" suffixes).
- **Save**: writes to the currently-open file. Disabled if no file is open.
- **Save As**: pick a new file location. Browser default location (typically `Downloads/`); no default filename suggested — type whatever you want.
- File contents: a single JSON file containing all your scenarios.

**File mode behaviour by browser**
- **Chrome / Edge / Brave** (File System Access API): once you've opened or saved a file, autosave silently writes to that file on every change. The header status shows "Saved to {filename}".
- **Safari / Firefox** (no File System Access API): autosave is disabled in file mode. You must click Save manually. Header shows "Unsaved · {filename}" when there are pending changes. Tab-close prompts a warning if you have unsaved changes.

**Cloud and file are mutually exclusive while a file is open**
- When a file is open, cloud autosave is paused — the file becomes the source of truth.
- The cloud copy "freezes" at whatever was last there.
- Click the small × in the file status indicator to close the file and resume cloud autosave from the current in-memory state.

**Franking dropdown fix for investment properties**
- The "Fully franked?" dropdown was showing on Investment Property assets, which doesn't make sense — rental income isn't dividend income, and franking only applies to AU-domiciled equities.
- Now hidden for property categories. Only shown for Shares (equities) with a positive dividend yield.

---

## v1.12 — 6 May 2026

**Liabilities tooltip**
- Liabilities chart now has a dedicated tooltip showing the per-loan breakdown, matching the per-category tooltip style introduced in v1.11.
- Headline shows total liabilities for the year. Each loan listed individually with its remaining balance.

**Retirement event display fix**
- Retirement events were showing a stale "$10k" amount in the events list because the default amount field stuck around when the event type changed to retirement.
- Now the amount is hidden from display when an event is a retirement type. (Data is unchanged — only the display is suppressed.)

**Smart event label staggering**
- When two or more events fall close together on the timeline (e.g. partner retirements within a few years), their labels used to overlap and become unreadable.
- Now labels are auto-staggered into vertical "lanes" — first event at the top, second event slightly below, and so on. Labels reset to the top lane when an event is far enough apart from previous events that there's no collision risk.
- Lane spacing: 18px per lane. Collision threshold: events within 3 years of each other.

---

## v1.11 — 6 May 2026

**Cashflow chart bars now align vertically**
- Added `stackOffset="sign"` to the cashflow chart, which is recharts' built-in mode for splitting positive and negative values around the x-axis.
- Income bars stack upward from zero, expense bars stack downward from zero, and they sit at the same x-position rather than being horizontally dodged.

**Per-category chart views now stack each constituent asset**
- The category-specific chart views (Primary Residence, Investment Property, Super, Shares, Other, Cash, Mortgage Offset) used to render as a single area showing the category total. They now stack each individual asset within the category as its own band, similar to how Liabilities already worked.
- All bands within a category share the category's base color; gradient opacity varies per asset so they stay visually distinct while reading as one category.
- For Mortgage Offset, each loan's offset balance shows as its own band, labelled "[asset name] offset".
- The "Stacked" view (which shows all categories together) is unchanged — it stays at category-level grouping.

**Per-category tooltip**
- When viewing a single-category chart, the tooltip now shows only that category's constituents instead of the full net wealth breakdown.
- Headline shows the category total (e.g. "Total Shares: $1.24M"). Each asset in the category is listed with its individual balance.
- The "Stacked" and "Net wealth" views still get the original full-breakdown tooltip.

---

## v1.10 — 6 May 2026

**Cashflow chart bars now align vertically (initial attempt)**
- Income and expense bars previously rendered side-by-side (horizontally dodged) because they used different stack IDs. (Replaced in v1.11 with the cleaner `stackOffset="sign"` solution.)

**Excess offset drain**
- Previously, if a loan paid down faster than its offset balance, the excess offset got "trapped" — earning no interest savings (since the loan was already covered) and not invested anywhere productive.
- Now: at the end of each year, after the cash sweep, the engine checks each loan. If `offsetBalance > loanBalance`, the excess is automatically routed to the configured cash optimisation equity target. If no equity target is configured, the excess flows to the first cash asset.
- Runs every year regardless of whether cash optimisation is enabled — this is a correctness fix, not an opt-in feature.
- Self-corrects manually entered offset balances that exceed the loan amount.

---

## v1.9 — 6 May 2026

**Cashflow chart bugfixes**
- Fixed bar stacking: income and expenses were sharing a single stack, causing positive bars to render on top of negative bars and obscure the actual cashflow shape. Now uses separate stack IDs so income stacks cleanly upward above the x-axis and expenses stack cleanly downward below it.
- Fixed tooltip: the cashflow view was showing the net wealth tooltip (asset breakdown by category, total wealth at top, etc.) which was confusing and unrelated to the chart. Now has a dedicated cashflow tooltip showing year-by-year breakdown of income components (Salary, Cash bonus, Asset income, Rental net, Event income), expense components (Living, School fees, Loan repayments, Tax, Rental loss, Event expense), and the resulting Net cashflow with totals.

---

## v1.8 — 2 May 2026

**Cashflow chart converted to stacked bars + tax included**
- Switched from area chart to **stacked bar chart** so each year reads as a discrete column rather than a smoothed area.
- **Income (green shades, above x-axis)**: Salary (gross), Cash bonus (gross), Asset income (interest + dividends), Rental net (when positive), Event income.
- **Expenses (red shades, below x-axis)**: Living expenses, School fees, Loan repayments, **Tax** (now included), Rental loss (when negative-geared), Event expenses.
- Share bonuses are excluded from the chart — they're not cash, just shares being granted. Dividends ON those shares (once held) do appear via Asset income.
- Tax is shown as an expense band, since real money leaves your account regardless of which slice of income triggered it.
- The white **Net** line shows true free cashflow per year (income minus all expenses including tax).
- Real/Nominal toggle works the same as other views.

---

## v1.7 — 2 May 2026

**Cashflow chart tab (initial version)**
- New "Cashflow" tab alongside Net Wealth / Stacked / Liabilities chart views.
- Income stacks above the x-axis: Salary, Cash bonus, Asset income, Rental net (when positive), Event income.
- Expenses stack below the x-axis: Living expenses, School fees, Loan repayments, Rental loss, Event expenses.
- White line overlaid showed Net (pre-tax). Tax was excluded.
- (Replaced in v1.8: switched to bars, added tax as an expense.)

---

## v1.6 — 2 May 2026

**Liability chart shows each loan stacked**
- The Liabilities view now stacks each loan as its own band so you can see how individual debts pay down over time.
- All loans share the danger-red hue, with each loan getting a slightly different gradient opacity to remain visually distinguishable.
- Hover tooltips show the per-loan balance.

**Property categories: Primary Residence vs Investment Property**
- The single "Property" category is split into two distinct categories: **Primary Residence** and **Investment Property**.
- Per-loan "Investment loan?" toggle on properties is removed — the property category drives it.
- Engine: only Investment Property generates rental income, deductible interest, and negative gearing. Primary Residence has none.
- Migration: any legacy property with at least one investment-flagged loan becomes Investment Property; otherwise Primary Residence. No manual rework.

**"Owned by (for tax)" dropdown removed from properties**
- Redundant with the ownership editor (introduced in v1.4) which handles per-earner percentage splits.
- Standalone investment liabilities (e.g. margin loans) keep their owned-by dropdown since they don't have ownership shares.

**Share Plan consolidated into Shares**
- The "sharePlan" category is merged into "equities". Both are now a single category labelled **Shares**.
- New field on each earner: **Shares vest into** — pick which Shares asset receives the share bonus vesting.
- Warning shown if share bonus is set but no Shares asset exists to track vesting.
- Migration: existing sharePlan assets are converted to equities.

**Reset confirmation message clarified**
- Reset now only resets the **current** scenario back to default. Other scenarios are unaffected.
- Message reads: *"Reset the current scenario [tab name] to default. Other scenarios are unaffected."*

**Concessional / non-concessional caps removed from Assumptions**
- Caps are sourced from ATO 2025–26 directly as constants (concessional $30k, non-concessional $120k).
- No longer user-editable. When ATO updates the caps in future years, the constants will be updated in code.

---

## v1.5 — 2 May 2026

**Offset moved onto the loan**
- Mortgage offsets are now configured on the loan itself rather than as a separate asset.
- Each loan's edit panel has an "Offset balance ($)" field — directly enter the dollar amount sitting in the offset.
- Offset balances still appear as cash-like rows in the wealth chart (under the Cash stack), so net wealth is unchanged.
- Auto-merge migration: any existing standalone "Mortgage Offset" assets that were linked to a loan have their balance moved onto the loan, and the standalone asset is deleted. No manual rework needed.
- The "+ Add Mortgage Offset" button is removed from the Assets section.

**Cash optimisation (sweep)**
- New global setting under Assumptions: configure how excess cash gets handled at the end of each year.
- Three modes:
  - **Off** — cash stays as cash (default).
  - **Offset account** — cash above the buffer fills the selected loan's offset (capped at the loan balance), with any spillover routed to the selected equity asset.
  - **Equities** — cash above the buffer is added to the selected equity asset.
- Required settings when enabled:
  - Minimum cash buffer (a $ amount the user nominates)
  - Source cash asset (which cash account to sweep from)
  - Target offset loan and/or target equity asset (depending on mode)
- Sweep happens at the end of each year, after all cashflow has been computed. So cash earned its growth/income for the year, then any surplus moves.
- If sweeping to an offset and the loan can only absorb part of the excess (because the loan balance is smaller than the excess), the rest spills to the designated equity asset. This means once a loan is fully paid down, the sweep automatically flows to equities going forward.

---

## v1.4 — 2 May 2026

**Joint asset ownership**
- Each non-cash, non-super asset can now be jointly owned by multiple earners.
- New ownership editor in the asset edit form: a small grid showing each earner with a percentage input. Total must sum to 100%.
- Tax and cashflow attribution (rental income, running expenses, investment loan interest deduction, dividends, franking credits, asset interest income) now distributes across owners according to their percentage shares.
- Helper buttons: "Split evenly" (when 2+ earners) and "100% to [name]" (when single earner).
- Migration: existing assets with `earnerId` set are converted to `ownershipShares: { [earnerId]: 100 }`. No manual rework needed.

**Yield-based equity income**
- Equities and Share Plan assets now use a "Dividend yield %" field instead of a flat $ income.
- Income each year is computed as `balance × yield`, so dividends naturally grow with the portfolio.
- "Fully franked?" dropdown (Yes / No / Partial) replaces the Franked % field for the common cases. Choosing "Partial" reveals the % input for unusual portfolios.
- Migration: existing assets with `income > 0` and `value > 0` get `dividendYield = income / value × 100`. New equities default to 4% yield, share plans to 0%.

**MLS calculation overhaul (per ATO 2025–26)**
- Updated thresholds to current ATO numbers:
  - Single: $101,000 / $118,000 / $158,000
  - Family: $202,000 / $236,000 / $316,000
- Family threshold now uplifts by $1,500 for each dependent child after the first (per ATO).
- MLS-purposes income now correctly distinct from taxable income — adds back deductible salary sacrifice and negative gearing losses, both of which the ATO requires.
- Result: a salary-sacrificing high earner without private health will now see materially higher MLS than before, matching real-life tax assessment.

**"SG" renamed to "Super Guarantee"**
- All UI labels: earner edit form, Logic tab Super card, Trace tab.
- Internal field names (`superSgRate`, `superSgIncludesBonus`) unchanged — code-level rename not needed.
- Removes confusion with "SG" used elsewhere as the country code for Singapore.

---

## v1.3 — 2 May 2026

**Mortgage Offset asset category**
- New "Mortgage Offset" asset category. Has only Name and Balance — no growth, no income, no franking.
- Engine: offset accounts are skipped in the asset growth loop, so they correctly earn 0% return (their benefit is reducing loan interest, not earning a yield).
- Loan "Offset from" dropdown now lists Mortgage Offset assets specifically.
- Auto-migration: existing cash assets that were linked as offsets are converted to the new category at load time, with growth and income cleared. No manual rewiring needed.
- Chart: Mortgage Offset balances share the Cash color and sit in the same stack position.
- "+ Add Mortgage Offset" button added at the bottom of the Assets section.

**Version label**
- Small monospace `vX.Y` label next to "The Ledger" in the header and on the login screen.

---

## v1.2 — 2 May 2026

**Excess super contributions now arrive in fund**
- Concessional contributions over the cap previously vanished from the model — only the within-cap portion was added to super.
- Now: full concessional contribution (within-cap + excess) gets the 15% fund tax and the after-tax remainder lands in super. Personal MTR-minus-15% tax on the excess is still charged on top, as the ATO does in real life.
- Same fix for non-concessional excess: full amount stays in fund (no penalty modelled; assumes user does not issue a release authority).
- Logic tab Super card and Trace tab updated to show the excess flowing to super, with separate lines for fund tax vs personal tax.

---

## v1.1 — 2 May 2026

**Infinite save loop fix**
- Saves to Supabase were retriggering the save effect, causing a continuous loop of HTTP requests with the sync indicator stuck on "Saving…".
- Moved the per-scenario `_supabaseId` from React state into a ref, so updates don't trigger re-renders or re-saves. Saves now fire once per edit, then return to "Synced".

**Earner form reshuffled**
- Edit form now arranges fields as: Base salary | Salary growth · Cash bonus | Share bonus · Tax method | Private health.

**Drag-to-reorder on lists**
- Every row in Income, Superannuation, Assets, School fees, Living expenses, Other debts, and Events has a left-edge drag handle (⋮⋮).
- Native HTML5 drag-and-drop, desktop-focused. Only the handle starts drags so clicking elsewhere on a row still expands it for editing.

---

## v1.0 — Initial deploy

**Supabase authentication and cloud sync**
- Email/password authentication, open signups.
- Per-user private scenarios via Postgres + RLS.
- Debounced 800ms autosave to Supabase, with localStorage as fallback cache.
- Sync indicator in header (Synced / Saving / Save failed).
- One-time migration from localStorage on first sign-in.
- Sign out button in header when authenticated.

**10 calculation accuracy fixes**
1. Salary sacrifice reduces taxable income (capped at concessional minus SG/match)
2. SG calculated on base only by default; per-earner toggle to include bonus
3. Medicare Levy Surcharge for high earners without private health
4. Real vs nominal display toggle in chart header (defaults nominal)
5. Investment property loan interest deductibility (per-loan flag)
6. Negative gearing on rental properties (running expenses + interest deduction)
7. Mortgage offset reduces effective interest (linked cash balance)
8. CGT on lump events with cost base, 50% discount if held >12 months
9. Asset income flows through tax (attributed to owner-earner)
10. Franking credits on AU-domiciled equities (per-asset franked %)

**Other**
- IO loans convert to P&I after the IO period, amortising over the remaining term.
- Retirement spending multiplier (default 0.75) applied when household is fully retired.
- Hosted on Vercel, repo on GitHub.

---
