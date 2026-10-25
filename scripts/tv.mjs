// UK TV channels for English football from live-footballontv.com (its robots.txt allows this),
// saved as JSON for the app because the site doesn't allow browser fetches. ESPN only lists US channels.
// Never fails the build: on error it keeps the previous file. `node scripts/tv.mjs --selftest` checks the parser.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import assert from 'node:assert';

// English men's competitions only (the app's leagues and cups); women's and youth games are dropped.
const ENGLISH = /^(Premier League|Championship|League One|League Two|FA Cup|Carabao Cup|EFL Trophy)(\s|$)/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();
const grab = (html, cls) => decode(html.match(new RegExp(`class="${cls}"[^>]*>([^<]*)<`))?.[1] || '');

function parseListings(html) {
  const out = [];
  for (const group of html.split('class="fixture-date"').slice(1)) {
    // "Sunday 25th October 2026" -> 2026-10-25 (UK dates, as listed)
    const m = group.match(/^>\s*\w+ (\d+)\w* (\w+) (\d{4})/);
    const mon = m && MONTHS.indexOf(m[2]);
    if (!m || mon < 0) continue;
    const date = `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    for (const fx of group.split('<div class="fixture">').slice(1)) {
      const comp = grab(fx, 'fixture__competition');
      const [home, away] = grab(fx, 'fixture__teams').split(' v ').map((t) => t?.trim());
      // Youth sides ("Ipswich Town U21") play in look-alike comps such as "Premier League 2".
      if (!ENGLISH.test(comp) || /Women/.test(comp) || !home || !away || /\bU\d\d$/.test(home)) continue;
      const channels = [...fx.matchAll(/class="channel-pill"[^>]*>([^<]+)</g)].map((c) => decode(c[1]));
      if (channels.length) out.push({ date, time: grab(fx, 'fixture__time'), home, away, comp, channels });
    }
  }
  return out;
}

const out = process.argv[2] || 'data/tv.json';

if (out === '--selftest') {
  const html = `<div class="fixture-group"><div class="fixture-date">Sunday 25th October 2026</div>
    <div class="fixture"><div class="fixture__time">14:00</div><div class="fixture__teams">Manchester United v AFC Bournemouth </div><div class="fixture__competition">Premier League</div><div class="fixture__channel"><div class="span3 channels"><span class="channel-pill" style="x">Sky Sports Main Event</span><span class="channel-pill" style="y">Sky Sports Ultra HDR</span></div></div></div>
    <div class="fixture"><div class="fixture__time">12:00</div><div class="fixture__teams">Arsenal Women v Chelsea Women </div><div class="fixture__competition">Women&#x27;s Super League</div><div class="fixture__channel"><span class="channel-pill">Sky Sports Mix</span></div></div>
    <div class="fixture"><div class="fixture__time">12:00</div><div class="fixture__teams">Ipswich Town U21 v Leeds U21 </div><div class="fixture__competition">Premier League 2</div><div class="fixture__channel"><span class="channel-pill">PL YouTube</span></div></div>
    </div><div class="fixture-group"><div class="fixture-date">Tuesday 3rd November 2026</div>
    <div class="fixture"><div class="fixture__time">19:45</div><div class="fixture__teams">Brighton &amp; Hove Albion v Oldham Athletic </div><div class="fixture__competition">Carabao Cup&nbsp;Round Four</div><div class="fixture__channel"><span class="channel-pill">Sky Sports+</span></div></div>`;
  assert.deepStrictEqual(parseListings(html), [
    { date: '2026-10-25', time: '14:00', home: 'Manchester United', away: 'AFC Bournemouth', comp: 'Premier League', channels: ['Sky Sports Main Event', 'Sky Sports Ultra HDR'] },
    { date: '2026-11-03', time: '19:45', home: 'Brighton & Hove Albion', away: 'Oldham Athletic', comp: 'Carabao Cup Round Four', channels: ['Sky Sports+'] },
  ]);
  console.log('tv selftest ok');
  process.exit(0);
}

mkdirSync(dirname(out), { recursive: true });
try {
  const r = await fetch('https://www.live-footballontv.com/', { headers: { 'user-agent': 'Mozilla/5.0 (personal scoreboard)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const fixtures = parseListings(await r.text());
  if (!fixtures.length) throw new Error('no fixtures found (page layout changed?)');
  writeFileSync(out, JSON.stringify({ updated: new Date().toISOString(), fixtures }));
  console.log(`UK TV: ${fixtures.length} English fixtures`);
} catch (e) {
  console.warn(`UK TV failed: ${e.message}`);
  let prev = '{"updated":null,"fixtures":[]}';
  try { prev = readFileSync(out, 'utf8'); } catch {}
  writeFileSync(out, prev);
}
