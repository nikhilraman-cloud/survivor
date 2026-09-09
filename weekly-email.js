#!/usr/bin/env node
// Generate the weekly recap email from league.json.
//
// Usage (run after results are recorded and currentWeek has advanced):
//   node weekly-email.js                       # recaps currentWeek - 1
//   node weekly-email.js --week 3              # recap a specific week
//   node weekly-email.js --data path/to/league.json --out path/to/dir
//
// Writes <out>/week-<N>-recap.html (open it, Ctrl+A, Ctrl+C, paste into Outlook)
// and prints the suggested subject line. Default out dir is ../out relative to
// this script, so the email never lands in the published site folder.

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };

const DATA = arg('data', path.join(__dirname, 'data', 'league.json'));
const OUT = arg('out', path.join(__dirname, '..', 'out'));
const SITE = arg('url', 'https://nikhilraman-cloud.github.io/survivor/');

const L = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const weeksN = Object.keys(L.weeks).map(Number).sort((a, b) => a - b);
const lastWeek = weeksN[weeksN.length - 1];
const week = Number(arg('week', L.seasonComplete ? lastWeek : L.currentWeek - 1));
if (!Number.isInteger(week) || week < 1 || week > lastWeek) {
  console.error(`No week to recap (computed week ${week}). Record results and advance currentWeek first, or pass --week N.`);
  process.exit(1);
}
const next = L.seasonComplete ? null : L.weeks[String(week + 1)];

const buyIn = n => L.rules.buyInSchedule[Math.min(n, L.rules.buyInSchedule.length) - 1];
const money = n => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isLive = e => e.status === 'alive' || e.status === 'winner';
const fmtLock = iso => new Date(iso).toLocaleString('en-US', {
  timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
}) + ' ET';

const nameOf = {};
(L.participants || []).forEach(p => nameOf[p.id] = p.name);
const label = e => `${nameOf[e.participantId] || e.participantId} #${e.entryNumber}`;

// Every team an entry has burned, week-labelled. Anything still hidden
// (a submitted pick for a week that has not kicked off) is left out.
function used(e) {
  return Object.keys(e.picks).map(Number).sort((a, b) => a - b)
    .filter(w => w <= week)
    .map(w => ({ w, t: e.picks[String(w)], res: (L.results[String(w)] || {})[e.picks[String(w)]] }));
}

const pot = L.entries.reduce((s, e) => s + buyIn(e.entryNumber), 0);
const alive = L.entries.filter(isLive);
const outThisWeek = L.entries.filter(e => e.eliminatedWeek === week);
const reasonWord = { loss: 'lost', tie: 'tied', missed: 'no pick submitted' };

// Rebuy windows that are open right now: last entry died in `week`, person is
// under the entry cap, and the next week has not locked yet.
const rebuys = [];
if (!L.seasonComplete && next) {
  const byP = {};
  L.entries.forEach(e => (byP[e.participantId] = byP[e.participantId] || []).push(e));
  Object.entries(byP).forEach(([pid, list]) => {
    list.sort((a, b) => a.entryNumber - b.entryNumber);
    const last = list[list.length - 1];
    if (last.eliminatedWeek === week && list.length < L.rules.maxEntriesPerPerson) {
      rebuys.push({ name: nameOf[pid] || pid, amount: buyIn(list.length + 1), n: list.length + 1 });
    }
  });
  rebuys.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- styles, inlined so an Outlook paste keeps them ----------
const S = {
  body: 'margin:0;padding:0;background:#f6f6f4;',
  wrap: 'max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e3e3df;border-radius:10px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a19;font-size:15px;line-height:1.45;',
  pad: 'padding:18px 22px;',
  h1: 'margin:0;font-size:20px;font-weight:700;letter-spacing:-0.01em;',
  sub: 'margin:4px 0 0;font-size:13px;color:#7a7a75;',
  h2: 'margin:0 0 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#4a4a47;',
  th: 'text-align:left;padding:7px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#7a7a75;border-bottom:1px solid #e3e3df;font-weight:700;',
  td: 'padding:8px 10px;border-bottom:1px solid #f1f1ee;font-size:13.5px;vertical-align:top;',
  tdr: 'padding:8px 10px;border-bottom:1px solid #f1f1ee;font-size:13.5px;text-align:right;white-space:nowrap;',
  statBox: 'padding:10px 12px;border:1px solid #e3e3df;border-radius:8px;',
  statLbl: 'font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#7a7a75;',
  statVal: 'font-size:19px;font-weight:700;padding-top:2px;',
  pillW: 'display:inline-block;background:#e3f6e3;color:#0b5d0b;border-radius:20px;padding:2px 8px;font-size:12px;font-weight:600;margin:0 4px 4px 0;white-space:nowrap;',
  pillL: 'display:inline-block;background:#fbe4e4;color:#8f1f1f;border-radius:20px;padding:2px 8px;font-size:12px;font-weight:600;margin:0 4px 4px 0;white-space:nowrap;',
  btn: 'display:inline-block;background:#1f4e79;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;',
  foot: 'padding:14px 22px;background:#f6f6f4;font-size:12px;color:#7a7a75;',
};

const stat = (lbl, val, sub) => `<td width="33%" style="${S.statBox}">
  <div style="${S.statLbl}">${esc(lbl)}</div><div style="${S.statVal}">${esc(val)}</div>
  ${sub ? `<div style="font-size:12px;color:#4a4a47;padding-top:2px;">${esc(sub)}</div>` : ''}</td>`;

const pills = e => used(e).map(h => {
  const won = h.res === 'W';
  return `<span style="${won ? S.pillW : S.pillL}">W${h.w} ${esc(h.t)}</span>`;
}).join('') || '<span style="font-size:12.5px;color:#7a7a75;">none</span>';

const rows = list => list.map(e => `<tr>
  <td style="${S.td}"><b>${esc(label(e))}</b></td>
  <td style="${S.td}">${pills(e)}</td>
  <td style="${S.tdr}">${isLive(e) ? `${32 - used(e).length} left` : `out W${e.eliminatedWeek}`}</td></tr>`).join('');

const section = (title, inner) =>
  `<tr><td style="${S.pad}border-top:1px solid #e3e3df;">
    <div style="${S.h2}">${esc(title)}</div>${inner}</td></tr>`;

let html = `<div style="${S.body}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${S.body}"><tr><td align="center" style="padding:16px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${S.wrap}" width="640">
<tr><td style="${S.pad}">
  <h1 style="${S.h1}">${esc(L.leagueName)} — Week ${week} recap</h1>
  <p style="${S.sub}">${alive.length} of ${L.entries.length} entries still alive${next && next.lock ? ` · Week ${week + 1} picks due ${esc(fmtLock(next.lock))}` : ''}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0" style="margin-top:12px;"><tr>
    ${stat('Pot', money(pot), `${L.entries.length} entries`)}
    ${stat('Alive', `${alive.length} / ${L.entries.length}`, `${L.entries.length - alive.length} eliminated`)}
    ${stat(L.seasonComplete ? 'Season' : 'Next deadline', L.seasonComplete ? 'Complete' : `Week ${week + 1}`, L.seasonComplete ? '' : (next && next.lock ? new Date(next.lock).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : ''))}
  </tr></table>
</td></tr>`;

html += section(`Eliminated in Week ${week}`, outThisWeek.length
  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${outThisWeek.map(e => {
      const h = used(e).find(x => x.w === week);
      return `<tr><td style="${S.td}"><b>${esc(label(e))}</b></td><td style="${S.tdr}">${h && h.t ? esc(h.t) + ' — ' : ''}${esc(reasonWord[e.eliminationReason] || e.eliminationReason || '')}</td></tr>`;
    }).join('')}</table>`
  : `<div style="font-size:13.5px;color:#4a4a47;">Nobody. Everyone who picked survived the week.</div>`);

if (rebuys.length) {
  html += section('Rebuy window open — closes at the next kickoff', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${
    rebuys.map(r => `<tr><td style="${S.td}"><b>${esc(r.name)}</b></td><td style="${S.tdr}">entry #${r.n} — ${money(r.amount)}</td></tr>`).join('')
  }</table><div style="font-size:12.5px;color:#7a7a75;padding-top:8px;">Reply to Nikhil before the first Week ${week + 1} kickoff. Miss the window and the rebuy is gone for the season.</div>`);
}

if (alive.length) {
  html += section(`Still alive — teams already used`, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><th style="${S.th}">Entry</th><th style="${S.th}">Teams used</th><th style="${S.th}text-align:right;">Left</th></tr>
    ${rows(alive.slice().sort((a, b) => label(a).localeCompare(label(b))))}</table>
    <div style="font-size:12.5px;color:#7a7a75;padding-top:10px;">Green = the pick won, red = it lost or tied. You cannot reuse a team you have already used. Full list of what you have left is on the dashboard under <b>Your picks</b>.</div>`);
}

const outAll = L.entries.filter(e => !isLive(e) && e.eliminatedWeek !== week);
if (outAll.length) {
  html += section(`Eliminated before Week ${week}`, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${rows(outAll.slice().sort((a, b) => (a.eliminatedWeek - b.eliminatedWeek) || label(a).localeCompare(label(b))))}</table>`);
}

html += `<tr><td style="${S.pad}border-top:1px solid #e3e3df;" align="center">
  <a href="${esc(SITE)}" style="${S.btn}">Open the dashboard</a>
  <div style="font-size:12.5px;color:#7a7a75;padding-top:10px;">Pick your name under <b>Your picks</b> to see your used and available teams.</div>
</td></tr>
<tr><td style="${S.foot}">
  One team per week, must win outright. Loss or tie or no pick = out. A team can only be used once per entry.
  Buy-ins ${L.rules.buyInSchedule.map(money).join(' → ')}, max ${L.rules.maxEntriesPerPerson} entries. ${esc(L.rules.payoutText)}
</td></tr>
</table></td></tr></table></div>`;

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `week-${week}-recap.html`);
fs.writeFileSync(file, html);

console.log(`Subject: Survivor — Week ${week} recap (${alive.length} alive, ${money(pot)} pot)`);
console.log(`Wrote:   ${file}`);
console.log(`         Open it in a browser, select all, copy, paste into Outlook.`);
if (outThisWeek.length) console.log(`Out W${week}: ${outThisWeek.map(label).join(', ')}`);
if (rebuys.length) console.log(`Rebuys:  ${rebuys.map(r => `${r.name} (${money(r.amount)})`).join(', ')}`);
