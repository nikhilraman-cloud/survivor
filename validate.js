#!/usr/bin/env node
// Integrity checks for data/league.json (and optionally the private ledger).
// Usage: node validate.js [data/league.json] [--ledger path/to/ledger.json]
// Exit code 0 = clean, 1 = errors. Warnings never fail the run.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const ledgerIdx = args.indexOf('--ledger');
const ledgerPath = ledgerIdx >= 0 ? args[ledgerIdx + 1] : null;
const file = args.filter((a, i) => a !== '--ledger' && !(ledgerIdx >= 0 && i === ledgerIdx + 1))[0] || path.join(__dirname, 'data', 'league.json');

const errors = [], warnings = [];
const err = m => errors.push(m), warn = m => warnings.push(m);

let L;
try { L = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error(`Cannot parse ${file}: ${e.message}`); process.exit(1); }

const weeks = Object.keys(L.weeks || {}).map(Number).sort((a, b) => a - b);
const lastWeek = weeks[weeks.length - 1];
const teams = new Set(Object.keys(L.teams || {}));
const sched = L.rules.buyInSchedule;
const maxE = L.rules.maxEntriesPerPerson;
const buyIn = n => sched[Math.min(n, sched.length) - 1];

// --- structural ---
if (teams.size !== 32) err(`teams: expected 32, found ${teams.size}`);
if (weeks.length !== 18) warn(`weeks: expected 18, found ${weeks.length}`);
if (!(L.currentWeek >= 1 && L.currentWeek <= lastWeek + 1)) err(`currentWeek ${L.currentWeek} out of range`);
weeks.forEach(w => {
  const wk = L.weeks[String(w)];
  if (!wk.lock || isNaN(new Date(wk.lock))) err(`week ${w}: bad lock timestamp`);
  (wk.byes || []).forEach(t => { if (!teams.has(t)) err(`week ${w}: unknown bye team ${t}`); });
});
const pIds = new Set();
(L.participants || []).forEach(p => {
  if (pIds.has(p.id)) err(`duplicate participant id ${p.id}`);
  pIds.add(p.id);
});

// --- entries ---
const eIds = new Set();
const byP = {};
(L.entries || []).forEach(e => {
  if (eIds.has(e.id)) err(`duplicate entry id ${e.id}`);
  eIds.add(e.id);
  if (!pIds.has(e.participantId)) err(`${e.id}: unknown participant ${e.participantId}`);
  (byP[e.participantId] = byP[e.participantId] || []).push(e);
  if (!['alive', 'eliminated', 'winner'].includes(e.status)) err(`${e.id}: bad status ${e.status}`);
  if (e.id !== `${e.participantId}-${e.entryNumber}`) warn(`${e.id}: id does not follow <participant>-<n> convention`);
  if (e.buyIn != null && e.buyIn !== buyIn(e.entryNumber)) err(`${e.id}: buyIn ${e.buyIn} should be ${buyIn(e.entryNumber)} for entry #${e.entryNumber}`);
  if (e.paid != null || e.paidDate || e.paidMethod) err(`${e.id}: payment fields belong in the private ledger, not the public file`);

  const picks = e.picks || {};
  const used = {};
  Object.entries(picks).forEach(([w, t]) => {
    const wn = Number(w);
    if (!teams.has(t)) err(`${e.id}: week ${w} pick ${t} is not a team`);
    if (used[t]) err(`${e.id}: ${t} used twice (weeks ${used[t]} and ${w})`);
    used[t] = w;
    if (wn < e.startWeek) err(`${e.id}: pick in week ${w} before startWeek ${e.startWeek}`);
    if (e.eliminatedWeek != null && wn > e.eliminatedWeek) err(`${e.id}: pick in week ${w} after elimination in week ${e.eliminatedWeek}`);
    if (wn > L.currentWeek) err(`${e.id}: pick recorded for future week ${w} (currentWeek ${L.currentWeek})`);
    const wk = L.weeks[String(w)];
    if (wk && (wk.byes || []).includes(t)) err(`${e.id}: ${t} is on bye in week ${w}`);
    if (wn < L.currentWeek) {
      const res = (L.results[String(w)] || {})[t];
      if (!res) err(`${e.id}: no result recorded for ${t} in completed week ${w}`);
    }
  });

  // status vs results consistency
  const elimEvents = [];
  for (let w = e.startWeek; w < L.currentWeek; w++) {
    const t = picks[String(w)];
    const res = t ? (L.results[String(w)] || {})[t] : null;
    if (!t) { elimEvents.push([w, 'missed']); break; }
    if (res === 'L') { elimEvents.push([w, 'loss']); break; }
    if (res === 'T' && L.rules.tie === 'loss') { elimEvents.push([w, 'tie']); break; }
  }
  if (elimEvents.length) {
    const [w, why] = elimEvents[0];
    if (e.status !== 'eliminated') err(`${e.id}: should be eliminated in week ${w} (${why}) but status is ${e.status}`);
    else if (e.eliminatedWeek !== w) err(`${e.id}: eliminatedWeek ${e.eliminatedWeek} but results imply week ${w}`);
    else if (e.eliminationReason !== why) warn(`${e.id}: eliminationReason ${e.eliminationReason} but results imply ${why}`);
  } else if (e.status === 'eliminated') {
    err(`${e.id}: marked eliminated (week ${e.eliminatedWeek}) but results do not show a loss/tie/missed pick before currentWeek`);
  }
  if (e.status === 'eliminated' && e.eliminatedWeek == null) err(`${e.id}: eliminated without eliminatedWeek`);
  if (e.status !== 'eliminated' && e.eliminatedWeek != null) err(`${e.id}: has eliminatedWeek but status ${e.status}`);
});

// --- per-person sequencing / rebuy window ---
Object.entries(byP).forEach(([pid, list]) => {
  list.sort((a, b) => a.entryNumber - b.entryNumber);
  if (list.length > maxE) err(`${pid}: ${list.length} entries exceeds max ${maxE}`);
  list.forEach((e, i) => {
    if (e.entryNumber !== i + 1) err(`${pid}: entry numbers must be sequential (found #${e.entryNumber} at position ${i + 1})`);
    if (i > 0) {
      const prev = list[i - 1];
      if (prev.status !== 'eliminated') err(`${e.id}: rebuy while prior entry ${prev.id} is still ${prev.status}`);
      else if (e.startWeek !== prev.eliminatedWeek + 1) err(`${e.id}: startWeek ${e.startWeek} must be the week right after ${prev.id} was eliminated (week ${prev.eliminatedWeek + 1}) — no delayed rebuys`);
    } else if (e.startWeek !== 1) warn(`${e.id}: first entry starts in week ${e.startWeek}, not week 1`);
  });
  const alive = list.filter(e => e.status === 'alive' || e.status === 'winner');
  if (alive.length > 1) err(`${pid}: more than one live entry at once`);
});

// --- results ---
Object.entries(L.results || {}).forEach(([w, map]) => {
  if (Number(w) >= L.currentWeek && !L.seasonComplete) warn(`results recorded for week ${w} but currentWeek is ${L.currentWeek} — advance currentWeek?`);
  Object.entries(map).forEach(([t, r]) => {
    if (!teams.has(t)) err(`results week ${w}: unknown team ${t}`);
    if (!['W', 'L', 'T'].includes(r)) err(`results week ${w}: ${t} has result ${r} (expected W/L/T)`);
  });
});

// --- pot & payouts ---
const pot = (L.entries || []).reduce((s, e) => s + buyIn(e.entryNumber), 0);
const winners = (L.entries || []).filter(e => e.status === 'winner');
if (winners.length && !L.seasonComplete) warn(`winners marked but seasonComplete is false`);
if (L.payouts && L.payouts.length) {
  const total = L.payouts.reduce((s, p) => s + Number(p.amount || 0), 0);
  if (Math.abs(total - pot) > 0.01) err(`payouts total ${total} != pot ${pot}`);
  L.payouts.forEach(p => {
    if (!eIds.has(p.entryId)) err(`payout for unknown entry ${p.entryId}`);
    if (p.paid != null || p.paidDate) err(`payout ${p.entryId}: disbursement status belongs in the private ledger`);
  });
}

// --- current-week status ---
const cwLock = L.weeks[String(L.currentWeek)] && new Date(L.weeks[String(L.currentWeek)].lock);
const missing = (L.entries || []).filter(e => e.status === 'alive' && !e.picks[String(L.currentWeek)]).map(e => e.id);
if (!L.seasonComplete && missing.length) console.log(`Week ${L.currentWeek} — still missing picks: ${missing.join(', ')}`);
if (cwLock && Date.now() > cwLock && !L.showCurrentWeekPicks && !L.seasonComplete) warn(`week ${L.currentWeek} has kicked off but showCurrentWeekPicks is still false (the page unhides automatically after lock, but flip the flag for clarity)`);

// --- private ledger (optional) ---
if (ledgerPath) {
  try {
    const G = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    const seen = new Set();
    (G.payments || []).forEach(p => {
      if (!eIds.has(p.entryId)) err(`ledger: payment for unknown entry ${p.entryId}`);
      if (seen.has(p.entryId)) err(`ledger: duplicate payment row for ${p.entryId}`);
      seen.add(p.entryId);
      const e = (L.entries || []).find(x => x.id === p.entryId);
      if (e && p.amount !== buyIn(e.entryNumber)) err(`ledger: ${p.entryId} amount ${p.amount} should be ${buyIn(e.entryNumber)}`);
      if (p.paid && !p.paidDate) warn(`ledger: ${p.entryId} paid but no paidDate`);
      if (p.paid && p.method && !(G.methods || []).includes(p.method)) warn(`ledger: ${p.entryId} method ${p.method} not in methods list`);
    });
    (L.entries || []).forEach(e => { if (!seen.has(e.id)) err(`ledger: no payment row for ${e.id}`); });
    const collected = (G.payments || []).filter(p => p.paid).reduce((s, p) => s + p.amount, 0);
    console.log(`Ledger: ${collected}/${pot} collected; unpaid: ${(G.payments || []).filter(p => !p.paid).map(p => p.entryId).join(', ') || 'none'}`);
  } catch (e) { err(`ledger: ${e.message}`); }
}

console.log(`Pot ${pot} · ${L.entries.length} entries · ${L.entries.filter(e => e.status === 'alive').length} alive · week ${L.currentWeek}`);
warnings.forEach(w => console.log(`WARN  ${w}`));
errors.forEach(e => console.log(`ERROR ${e}`));
console.log(errors.length ? `\n${errors.length} error(s)` : '\nOK — no errors');
process.exit(errors.length ? 1 : 0);
