# Changelog

All notable changes to The Ledger are recorded here. Each entry corresponds to a deployment.

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
