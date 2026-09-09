# Office Survivor 2026 — tracker

Static GitHub Pages dashboard for an office NFL survivor league. One commissioner edits a JSON file (via Cowork); everyone else views a link.

- **Live dashboard:** https://nikhilraman-cloud.github.io/survivor/
- **Sample data (for testing the page):** https://nikhilraman-cloud.github.io/survivor/?data=sample
- **Repo:** https://github.com/nikhilraman-cloud/survivor

## Files

| File | Purpose |
|---|---|
| `index.html` | The dashboard. Vanilla JS, no build step. Fetches `data/league.json` (or `data/<name>.json` via `?data=<name>`). |
| `data/league.json` | **Public** league state: rules, week lock times and byes, teams, participants, entries, picks, results, payouts. No payment data. |
| `data/sample.json` | Fake Weeks 1–5 data covering an elimination, a rebuy, a tie, a missed pick, and an open rebuy window. Safe to delete once the season is running. |
| `validate.js` | Integrity checks. Run before every commit: `node validate.js` (add `--ledger <path>` to cross-check the private ledger). |
| `weekly-email.js` | Generates the Tuesday recap email as paste-ready HTML. Writes to `..\out\week-N-recap.html` — outside the published folder. |

**Private ledger (not in this repo):** `%OneDriveCommercial%\Claude\survivor\ledger.json` holds who has paid, how, and when, plus payout disbursement status and contact handles. The public page only shows the pot total (derived from entry count × buy-in schedule) and a note that payment is tracked offline.

## What players see

The dashboard has a **Your picks** panel at the top: pick your name from the dropdown and it shows, per entry, the teams you have already used (week-labelled, green if the pick won, red if it lost or tied) and the teams you still have available. The browser remembers your name, so it is one tap on a return visit. **Teams used & available** lower down shows the same thing for everyone, collapsed.

Team abbreviations are **bracketed by that team's two colors** — primary on the left edge, secondary on the right — in the standings cells and on every chip, so you can scan the grid without reading each code. The cell fill still means won / lost / pending; identity lives on the edges so the two never fight. All 32 pairs are distinct, so the bracket identifies a team on its own. Pure black and pure white are never used (they vanish against one surface or the other) — those slots take a dark charcoal or a mid grey — and in dark mode both edges are lifted via `color-mix` so dark navies stay visible.

A submitted pick for the current week is never named before kickoff — the panel says "pick is in — hidden until kickoff" and that team stays in your available list, so nobody can work out a pending pick by comparing lists.

## Rules encoded

- 18 regular-season weeks. Each live entry picks one team to win outright.
- Loss = eliminated. Tie = eliminated. Missed pick = eliminated.
- A team can be used once per entry across the season.
- Buy-ins per person, sequential: $20 → $50 → $100. Max 3 entries per person.
- Rebuy only after the prior entry is eliminated, and only before the next week's first kickoff (i.e., the new entry's `startWeek` must equal the prior entry's `eliminatedWeek + 1`). No delayed rebuys — the validator enforces this.
- Pot = all buy-ins. Winner-take-all; equal split if multiple entries survive Week 18 or if all remaining entries die in the same week.
- Picks for the current week are hidden until kickoff. The page unhides automatically once the week's `lock` time passes; `showCurrentWeekPicks: true` forces it earlier.

## Data model

```jsonc
{
  "leagueName": "Office Survivor 2026",
  "season": 2026,
  "currentWeek": 3,               // the week currently accepting picks
  "showCurrentWeekPicks": false,  // flip to true at kickoff (page also auto-unhides after lock)
  "seasonComplete": false,
  "lastUpdated": "2026-09-22",
  "rules": { "buyInSchedule": [20, 50, 100], "maxEntriesPerPerson": 3, "tie": "loss", "missedPick": "eliminated", ... },
  "weeks": { "1": { "lock": "2026-09-09T20:20:00-04:00", "byes": [], "note": "..." }, ... },
  "teams": { "ARI": "Arizona Cardinals", ... },
  "participants": [ { "id": "jsmith", "name": "J. Smith" } ],
  "entries": [
    { "id": "jsmith-1", "participantId": "jsmith", "entryNumber": 1, "startWeek": 1,
      "status": "alive",                  // alive | eliminated | winner
      "eliminatedWeek": null, "eliminationReason": null,   // loss | tie | missed
      "picks": { "1": "PHI", "2": "KC" } }
  ],
  "results": { "1": { "PHI": "W", "DAL": "L", "MIA": "T" } },   // only picked teams need results
  "payouts": [ { "entryId": "jsmith-1", "amount": 340 } ]        // written at season end; no paid flags here
}
```

Conventions: entry id = `<participantId>-<entryNumber>`. Buy-in is derived from `entryNumber` (never stored). Week lock times are first kickoff in ET; Week 1 opens **Wednesday Sept 9**, Week 12 is Thanksgiving (12:30 PM), Week 18 has no Thursday game (Saturday assumed — confirm when the schedule is final and edit `weeks.18.lock`).

## Weekly operating workflow

**Tue–Thu — picks arrive by email/Teams.** Paste them into Cowork:

> Week 3 picks: Smith-1 PHI, Jones-2 BUF, Lee-1 DET

Cowork validates each pick (entry is alive, team not already used by that entry, team is not on bye), writes to `league.json`, runs `validate.js`, commits and pushes, and replies with the list of alive entries still missing a pick.

**Kickoff (usually Thursday night).** Cowork flips `showCurrentWeekPicks` to true and pushes. Post the dashboard link to Teams. (If you forget, the page unhides itself after the lock time anyway.)

**Tuesday morning — results.** Paste the losers (and any ties):

> Week 3 results: losers DAL, MIA, NYJ; tie CHI

Cowork marks W/L/T for every picked team, eliminates entries (loss, tie, or no pick), sets `eliminatedWeek`/`eliminationReason`, advances `currentWeek`, flips `showCurrentWeekPicks` back to false, validates, pushes, and returns a Teams-ready summary: eliminated this week, alive count, pot, who is rebuy-eligible and for how much.

**Rebuys.** When someone eliminated last week says they're back in:

> Jones rebuys

Cowork adds `jones-2` (`startWeek` = current week, `entryNumber` = 2) to the public file and an unpaid $50 row to the private ledger. Cowork refuses a rebuy if the person's last entry wasn't eliminated in `currentWeek − 1`, if they already have 3 entries, or if this week has already locked.

**Payments** (private ledger only, never pushed):

> Jones paid $50 Venmo

**Tuesday, after results — the recap email.** Cowork runs `weekly-email.js` and hands you the HTML file plus a subject line. Open it, select all, copy, paste into Outlook. It contains: pot and alive count, who was eliminated this week and how, any open rebuy windows with amounts and the deadline, a **teams-already-used table for every live entry** (the reference people ask for), the entries knocked out in earlier weeks, and a link to the dashboard.

```powershell
node site\weekly-email.js                 # recaps currentWeek - 1
node site\weekly-email.js --week 3        # a specific week
```

It refuses to run before any week has been played. Regenerating overwrites that week's file, so fixing a result and re-running is safe.

**Season end.**

> Close out the season

Cowork sets `seasonComplete`, marks winner(s), writes `payouts` (equal split of the pot), validates, pushes, and produces a disbursement checklist from the ledger (who gets what, who still owes a buy-in to net against).

## Prompt cheat-sheet

| You say | Cowork does |
|---|---|
| `Week N picks: Smith-1 PHI, Jones-2 BUF, ...` | Validate, record, push, list missing picks |
| `Who hasn't picked?` | List alive entries without a Week N pick |
| `Unlock picks` / `Kickoff` | `showCurrentWeekPicks: true`, push |
| `Week N results: losers X, Y; tie Z` | Record W/L/T, eliminate, advance week, push, Teams summary |
| `Add participant J. Smith` | New participant + entry `jsmith-1` ($20, unpaid in ledger) |
| `Jones rebuys` | New entry at next buy-in tier if eligible |
| `Jones paid $50 Venmo` | Ledger update only |
| `Who owes money?` | Unpaid rows from the ledger |
| `Send the weekly email` | Generate `week-N-recap.html` + subject line, ready to paste into Outlook |
| `Close out the season` | Winners, payouts, disbursement checklist |
| `Fix: Week 2 Smith-1 should be KC, not PHI` | Edit + re-validate + push (git history keeps the audit trail) |

Entry shorthand: `Lastname-N` maps to `<participantId>-N`; a bare last name means that person's live entry.

## How updates get published

The working copy lives in OneDrive at `%OneDriveCommercial%\Claude\survivor\site\` (this repo's files, no `.git`). Next to it: `ledger.json` (private) and `publish.py`, which pushes changed files straight to `main` through the GitHub Contents API — no clone, no git on the machine required.

```powershell
cd "$env:OneDriveCommercial\Claude\survivor"
node site\validate.js site\data\league.json --ledger ledger.json
$env:GITHUB_TOKEN = "<token>"; python publish.py "Week 3 picks"
```

Cowork does this for you; the token comes from an env var (or a `.token` file beside `publish.py`, never committed). To preview locally: `python -m http.server 8000` inside `site\` and open `http://localhost:8000/?data=sample`. GitHub Pages picks up pushes within about a minute.
