// Scoreboard: live scores, fixtures and tables for a handful of sports.
// Data: ESPN's public JSON (unofficial), Jolpica (F1), TheSportsDB (boxing),
// plus data/ufc-rankings.json built by a GitHub Action.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_V2 = 'https://site.api.espn.com/apis/v2/sports';
const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const TZ = 'Europe/London';
const DAYS_AHEAD = 14;

const FOOTBALL_LEAGUES = [
  { code: 'eng.1', name: 'Premier League', table: true },
  { code: 'eng.2', name: 'Championship', table: true },
  { code: 'eng.3', name: 'League One', table: true },
  { code: 'eng.4', name: 'League Two', table: true },
  { code: 'eng.fa', name: 'FA Cup' },
  { code: 'eng.league_cup', name: 'EFL Cup' },
];

// News tab: followed teams get notes (position, last result, next game) plus their news.
// `path` is the team's ESPN league; change Oldham's if they're promoted or relegated.
const FOLLOW = [
  { name: 'Oldham Athletic', sport: 'football', path: 'soccer/eng.4', id: 332, match: /oldham/i, bbc: 'oldham', club: clubNews, forum: 'forum' },
  { name: 'Manchester United', sport: 'football', path: 'soccer/eng.1', id: 360, match: /man(chester)? (united|utd)/i, bbc: 'manutd' },
  { name: 'Pittsburgh Steelers', sport: 'nfl', path: 'football/nfl', id: 23, match: /steelers/i },
];
// Official oldhamathletic.co.uk news: the site's own CMS API, which allows browser access.
// The fans' forum (via data/news.json) is shown separately and labelled as opinion.
async function clubNews() {
  const d = await getJSON('https://news.cms.web.gc.oldhamathleticafcservices.co.uk/v2/search?page.size=15&sort=publishedDateTime:desc&q=');
  return (d.data || []).map(({ attributes: a = {} }) => ({
    title: a.postTitle?.trim(), url: a.postSlug && `https://www.oldhamathletic.co.uk${a.postSlug}`,
    date: a.publishedDateTime, desc: a.description, source: `Club · ${a.postCategoryName || 'News'}`, official: true,
  }));
}

const IRISH_FLAGS =new Set(['Ireland', 'Northern Ireland']);
const IRISH_NEWS = /McIlroy|Lowry|S[eé]amus Power|Harrington|McKibbin|McDowell|Darren Clarke|Leona Maguire|Stephanie Meadow|\bIrish\b/i;
// ESPN news per sport (boxing has none on ESPN; it comes from BBC via data/news.json).
const NEWS_PATHS = { football: ['soccer/eng.1', 'soccer/eng.2'], nfl: ['football/nfl'], golf: ['golf/pga', 'golf/eur'], f1: ['racing/f1'], ufc: ['mma/ufc'], boxing: [], darts: [] };
const BBC_FOR_SPORT = { golf: 'golf', boxing: 'boxing', darts: 'darts' };

const SPORTS = [
  { id: 'all', label: 'All' },
  { id: 'football', label: 'Football' },
  { id: 'nfl', label: 'NFL' },
  { id: 'golf', label: 'Golf' },
  { id: 'f1', label: 'F1' },
  { id: 'ufc', label: 'UFC' },
  { id: 'boxing', label: 'Boxing' },
  { id: 'darts', label: 'Darts' },
];

// ---------- small helpers ----------

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const val = (x) => (x && typeof x === 'object' ? x.displayValue ?? x.value : x);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (d) => fmtKey.format(d);
const todayKey = () => dayKey(new Date());
const time = (d) => (isNaN(d) ? '' : fmtTime.format(d));
function dayLabel(d) {
  const k = dayKey(d);
  if (k === todayKey()) return 'Today';
  if (k === dayKey(new Date(Date.now() + 864e5))) return 'Tomorrow';
  return fmtDay.format(d);
}
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const addDays = (n) => new Date(Date.now() + n * 864e5);

async function getJSON(url, timeout = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    // no-cache = always revalidate, so a stale data/*.json or scoreboard is never shown from the browser cache.
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// ---------- state ----------

const state = {
  sport: store.get('sport', 'all'),
  tab: store.get('tab', 'today'),
  tableSport: store.get('tableSport', 'football'),
  sub: store.get('sub', {}), // remembered sub-tab per table sport
  favs: new Set(store.get('favs', [])),
  data: {},   // sport -> { events, error, ... }
  tables: {}, // key -> data
  loading: false,
  updated: null,
};

const isFav = (name) => name && state.favs.has(name);
function toggleFav(name) {
  state.favs.has(name) ? state.favs.delete(name) : state.favs.add(name);
  store.set('favs', [...state.favs]);
  syncAlertTeams();
  render();
}

// Android app only: tell it which football teams get goal/card alerts (followed teams + ★ favourites).
// Non-football favourites (drivers, fighters) are harmless: the app only matches football team names.
function syncAlertTeams() {
  try { window.Android?.setAlertTeams(JSON.stringify([...FOLLOW.filter((t) => t.sport === 'football').map((t) => t.name), ...state.favs])); } catch { /* not in the app */ }
}

// ---------- loaders: each returns { events: [...] } ----------

function espnTeam(c) {
  if (!c) return { name: 'TBC' };
  const t = c.team || c.athlete || {};
  return {
    name: t.shortDisplayName || t.displayName || t.name || 'TBC',
    full: t.displayName || t.name,
    logo: t.logo || t.logos?.[0]?.href || t.flag?.href,
    score: val(c.score),
    winner: c.winner,
  };
}

function espnStatus(ev, comp) {
  const s = comp?.status || ev.status || {};
  const t = s.type || {};
  return { state: t.state || 'pre', text: t.shortDetail || t.detail || t.description || '', clock: s.displayClock };
}

function espnMatch(ev, sport, league, awayFirst, path) {
  const comp = ev.competitions?.[0] || {};
  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home') || cs[0];
  const away = cs.find((c) => c.homeAway === 'away') || cs[1];
  const st = espnStatus(ev, comp);
  const a = espnTeam(home), b = espnTeam(away);
  a.inc = incidents(comp, home?.team?.id);
  b.inc = incidents(comp, away?.team?.id);
  return {
    kind: 'match', sport, league, id: ev.id, path, // path: ESPN league, e.g. soccer/eng.1 (for the match page)
    start: new Date(ev.date), ...st,
    sides: awayFirst ? [b, a] : [a, b],
    venue: comp.venue?.fullName,
    note: comp.notes?.[0]?.headline,
    // NFL: game's top passer / rusher / receiver, e.g. "Pass: C.J. Stroud 24/34, 312 YDS, 3 TD".
    leaders: (comp.leaders || []).map((l) => {
      const x = l.leaders?.[0];
      return x && `${LEADER_LABEL[l.name] || l.shortDisplayName || l.name}: ${x.athlete?.shortName || x.athlete?.displayName} ${x.displayValue}`;
    }).filter(Boolean).slice(0, 3),
  };
}

const LEADER_LABEL = { passingYards: 'Pass', rushingYards: 'Rush', receivingYards: 'Rec' };

// Football: one team's goals and red cards from ESPN's match details, grouped by player,
// e.g. "Hinshelwood 12', 84' · Gross 30' pen · 🟥 Danso 17'". ESPN credits own goals to the team that benefits.
function incidents(comp, teamId) {
  const byPlayer = new Map();
  for (const d of comp.details || []) {
    if (!teamId || d.team?.id !== teamId || !(d.scoringPlay || d.redCard)) continue;
    const p = d.athletesInvolved?.[0] || {};
    const key = `${d.redCard ? '🟥 ' : ''}${p.shortName || p.displayName || '?'}`;
    const min = `${d.clock?.displayValue || ''}${d.ownGoal ? ' og' : d.penaltyKick ? ' pen' : ''}`;
    byPlayer.set(key, [...(byPlayer.get(key) || []), min]);
  }
  return [...byPlayer].map(([who, mins]) => `${who} ${mins.join(', ')}`).join(' · ');
}

// ESPN now returns 400 for date ranges on soccer/NFL, but whole months (YYYYMM) work.
// Fetch the month(s) covering yesterday..DAYS_AHEAD and trim to that window.
async function espnWindow(path) {
  const from = ymd(addDays(-1)), to = ymd(addDays(DAYS_AHEAD));
  const months = [...new Set([from, to].map((d) => d.slice(0, 6)))];
  const res = await Promise.all(months.map((m) => getJSON(`${ESPN}/${path}/scoreboard?dates=${m}&limit=300`)));
  return {
    events: res.flatMap((d) => d.events || []).filter((ev) => {
      const day = ymd(new Date(ev.date));
      return day >= from && day <= to;
    }),
  };
}

async function loadFootball() {
  const res = await Promise.allSettled(FOOTBALL_LEAGUES.map((l) => espnWindow(`soccer/${l.code}`)));
  const events = [], errors = [];
  res.forEach((r, i) => {
    const l = FOOTBALL_LEAGUES[i];
    if (r.status === 'fulfilled') (r.value.events || []).forEach((ev) => events.push(espnMatch(ev, 'football', l.name, false, `soccer/${l.code}`)));
    else errors.push(l.name);
  });
  if (errors.length === FOOTBALL_LEAGUES.length) throw new Error('No football data');
  return { events, partial: errors };
}

async function loadNFL() {
  const d = await espnWindow('football/nfl');
  return { events: (d.events || []).map((ev) => espnMatch(ev, 'nfl', 'NFL', true, 'football/nfl')) };
}

// ESPN hides each round's tee time as the last stat of that round, in US time,
// e.g. "Sun Oct 25 08:46:00 PDT 2026". Converted to a real time so it shows in UK time.
const US_TZ = { PST: -8, PDT: -7, MST: -7, MDT: -6, CST: -6, CDT: -5, EST: -5, EDT: -4, GMT: 0, UTC: 0 };
function teeTimeOf(round) {
  const s = round?.statistics?.categories?.[0]?.stats?.at(-1)?.displayValue;
  const m = /^\w{3} (\w{3}) (\d+) (\d+):(\d+):\d+ ([A-Z]{3}) (\d{4})$/.exec(s || '');
  if (!m || US_TZ[m[5]] == null) return null;
  const mon = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(m[1]) / 3;
  return new Date(Date.UTC(+m[6], mon, +m[2], +m[3] - US_TZ[m[5]], +m[4]));
}
const fmtWeekday = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' });

function golfBoard(ev, tour) {
  const comp = ev.competitions?.[0] || {};
  const st = espnStatus(ev, comp);
  const holes = (r) => r?.linescores?.length || 0; // PGA Tour lists each round's holes played so far
  // DP World Tour sends round totals without holes, so a round with strokes counts as played.
  const played = (r) => holes(r) > 0 || r?.value > 0;
  // Finished for good (a suspended round is "post" but not completed, and still has tee times).
  const done = (comp.status || ev.status)?.type?.completed === true;
  // The round in play: the latest round anyone has started.
  const roundNow = Math.max(0, ...(comp.competitors || []).flatMap((c) => (c.linescores || []).filter(played).map((r) => r.period)));
  const players = (comp.competitors || [])
    .slice()
    .sort((a, b) => (a.sortOrder ?? a.order ?? 999) - (b.sortOrder ?? b.order ?? 999))
    .map((c) => {
      const rounds = c.linescores || [];
      const cur = rounds.filter(played).at(-1); // latest round this player has started
      const next = !done && rounds.find((r) => r.period > (cur?.period || 0) && !played(r) && teeTimeOf(r));
      const tee = next && teeTimeOf(next);
      let thru;
      if (cur && cur.period === roundNow && holes(cur) && holes(cur) < 18) thru = holes(cur); // on the course
      else if (tee) thru = dayKey(tee) === todayKey() ? time(tee) : `${fmtWeekday.format(tee)} ${time(tee)}`; // tee time, UK
      else if (cur && cur.period < roundNow) thru = 'CUT'; // missed the cut (or withdrew)
      else thru = cur ? 'F' : '';
      return {
        name: c.athlete?.displayName || c.athlete?.shortName || '—',
        flag: c.athlete?.flag?.href,
        country: c.athlete?.flag?.alt,
        toPar: val(c.score) ?? '',
        thru,
        // This round's score; blank while waiting to tee off (it would be yesterday's).
        today: !tee && cur?.period === roundNow ? cur.displayValue ?? '' : '',
      };
    });
  // ESPN no longer sends positions, so rank by score: equal scores share a place ("T2").
  players.forEach((p, i) => {
    const first = players.findIndex((q) => q.toPar === p.toPar);
    const tied = players.filter((q) => q.toPar === p.toPar).length > 1;
    p.pos = p.thru === 'CUT' ? 'CUT' : `${tied ? 'T' : ''}${first + 1}`;
  });
  return {
    kind: 'board', sport: 'golf', league: tour, id: ev.id, name: ev.name || ev.shortName,
    start: new Date(ev.date), end: ev.endDate ? new Date(ev.endDate) : null,
    ...st, rows: players,
  };
}

function calendarEntries(d, sport, league) {
  const cal = d.leagues?.[0]?.calendar || [];
  return cal
    .filter((c) => c && typeof c === 'object' && c.startDate)
    .map((c) => ({
      kind: 'listing', sport, league, id: `${sport}-${c.id || c.label}-${c.startDate}`,
      name: c.label || c.value, start: new Date(c.startDate), end: c.endDate ? new Date(c.endDate) : null, state: 'pre',
    }));
}

async function loadGolf() {
  const tours = [{ code: 'pga', name: 'PGA Tour' }, { code: 'eur', name: 'DP World Tour' }];
  const res = await Promise.allSettled(tours.map((t) => getJSON(`${ESPN}/golf/${t.code}/scoreboard`)));
  const events = [];
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const boards = (r.value.events || []).map((ev) => golfBoard(ev, tours[i].name));
    events.push(...boards);
    const ids = new Set(boards.map((b) => b.name));
    calendarEntries(r.value, 'golf', tours[i].name)
      .filter((c) => !ids.has(c.name))
      .forEach((c) => events.push(c));
  });
  if (!events.length && res.every((r) => r.status === 'rejected')) throw new Error('No golf data');
  return { events };
}

function f1Sessions(race) {
  const s = [];
  const add = (name, o) => o?.date && s.push({ name, start: new Date(`${o.date}T${o.time || '00:00:00Z'}`) });
  add('Practice 1', race.FirstPractice);
  add('Practice 2', race.SecondPractice);
  add('Practice 3', race.ThirdPractice);
  add('Sprint Qualifying', race.SprintQualifying || race.SprintShootout);
  add('Sprint', race.Sprint);
  add('Qualifying', race.Qualifying);
  add('Race', { date: race.date, time: race.time });
  return s.sort((a, b) => a.start - b.start);
}

async function loadF1() {
  const [sched, live] = await Promise.allSettled([
    getJSON(`${JOLPICA}/current.json`),
    getJSON(`${ESPN}/racing/f1/scoreboard`),
  ]);
  const events = [];
  if (sched.status === 'fulfilled') {
    for (const race of sched.value.MRData?.RaceTable?.Races || []) {
      for (const s of f1Sessions(race)) {
        events.push({
          kind: 'session', sport: 'f1', league: 'Formula 1', id: `f1-${race.round}-${s.name}`,
          name: race.raceName, session: s.name, start: s.start,
          venue: `${race.Circuit?.circuitName || ''}${race.Circuit?.Location?.country ? ', ' + race.Circuit.Location.country : ''}`,
          state: s.start < new Date(Date.now() - 2 * 3600e3) ? 'post' : 'pre',
        });
      }
    }
  }
  // ESPN gives live timing order / results for the current weekend's sessions.
  if (live.status === 'fulfilled') {
    for (const ev of live.value.events || []) {
      for (const comp of ev.competitions || []) {
        const st = espnStatus(ev, comp);
        const rows = (comp.competitors || [])
          .slice()
          .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
          .map((c, i) => ({ pos: c.order || i + 1, name: c.athlete?.displayName || c.athlete?.shortName || '—', flag: c.athlete?.flag?.href, toPar: '', thru: '', today: '' }));
        if (!rows.length) continue;
        events.push({
          kind: 'board', sport: 'f1', league: 'Formula 1', id: `f1-espn-${comp.id}`,
          name: `${ev.shortName || ev.name} · ${comp.type?.abbreviation || comp.type?.text || 'Session'}`,
          start: new Date(comp.date || comp.startDate || ev.date), ...st, rows, f1: true,
        });
      }
    }
  }
  if (sched.status === 'rejected' && live.status === 'rejected') throw new Error('No F1 data');
  return { events };
}

function ufcCard(ev) {
  const st = espnStatus(ev, null);
  const bouts = (ev.competitions || []).map((b) => {
    const cs = b.competitors || [];
    const bs = espnStatus(ev, b);
    return {
      a: cs[0]?.athlete?.displayName || cs[0]?.athlete?.shortName || 'TBC',
      b: cs[1]?.athlete?.displayName || cs[1]?.athlete?.shortName || 'TBC',
      aw: cs[0]?.winner, bw: cs[1]?.winner,
      cls: b.type?.abbreviation || b.type?.text || '',
      start: new Date(b.date || ev.date),
      ...bs,
    };
  });
  // ESPN lists prelims first; show the main event at the top.
  bouts.reverse();
  return {
    kind: 'card', sport: 'ufc', league: 'UFC', id: ev.id, name: ev.name || ev.shortName,
    start: new Date(ev.date), ...st, bouts, venue: ev.competitions?.[0]?.venue?.fullName,
  };
}

async function loadUFC() {
  const range = `${ymd(addDays(-2))}-${ymd(addDays(60))}`;
  const [cur, ranged] = await Promise.allSettled([
    getJSON(`${ESPN}/mma/ufc/scoreboard`),
    getJSON(`${ESPN}/mma/ufc/scoreboard?dates=${range}`),
  ]);
  const byId = new Map();
  const cal = [];
  for (const r of [cur, ranged]) {
    if (r.status !== 'fulfilled') continue;
    (r.value.events || []).forEach((ev) => byId.set(ev.id, ufcCard(ev)));
    cal.push(...calendarEntries(r.value, 'ufc', 'UFC'));
  }
  if (cur.status === 'rejected' && ranged.status === 'rejected') throw new Error('No UFC data');
  const names = new Set([...byId.values()].map((c) => c.name));
  const seen = new Set();
  const listings = cal.filter((c) => !names.has(c.name) && !seen.has(c.id) && seen.add(c.id));
  return { events: [...byId.values(), ...listings] };
}

// TheSportsDB's league search no longer lists boxing (free key returns 5 leagues), so use its id directly.
const BOXING_LEAGUES = [{ id: 4445, name: 'Boxing' }];

function tsdbEvent(e, league) {
  const start = e.strTimestamp
    ? new Date(e.strTimestamp.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(e.strTimestamp) ? e.strTimestamp : e.strTimestamp + 'Z')
    : new Date(`${e.dateEvent}T${e.strTime || '00:00:00'}Z`);
  return {
    kind: 'fight', sport: 'boxing', league, id: `tsdb-${e.idEvent}`, name: e.strEvent,
    start, venue: [e.strVenue, e.strCity, e.strCountry].filter(Boolean).join(', '),
    result: e.strResult, state: start < new Date(Date.now() - 6 * 3600e3) ? 'post' : 'pre',
  };
}

async function loadBoxing() {
  const reqs = BOXING_LEAGUES.flatMap((l) => [
    getJSON(`${TSDB}/eventsnextleague.php?id=${l.id}`).then((d) => ({ l, d })),
    getJSON(`${TSDB}/eventspastleague.php?id=${l.id}`).then((d) => ({ l, d })),
  ]);
  const res = await Promise.allSettled(reqs);
  if (res.every((r) => r.status === 'rejected')) throw new Error('No boxing data');
  const map = new Map();
  for (const r of res) {
    if (r.status !== 'fulfilled') continue;
    for (const e of r.value.d?.events || r.value.d?.results || []) map.set(e.idEvent, tsdbEvent(e, r.value.l.name));
  }
  return { events: [...map.values()] };
}

// PDC darts from TheSportsDB league 4554. Each event is one tournament day; its result text
// fills in as matches finish ("Round One x8", "Littler 6-3 O'Connor", "Rock v Dobey").
// ponytail: the free key only returns the latest and next day, so there's no long-range calendar.
const DARTS_LEAGUE = 4554;

function dartsEvent(e) {
  const start = new Date(`${e.dateEvent}T00:00:00Z`); // TheSportsDB gives no session times for darts
  const lines = String(e.strResult || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const won = l.match(/^(.+?) (\d+)-(\d+) (.+)$/);
    if (won) return { a: won[1], as: +won[2], bs: +won[3], b: won[4] };
    const due = l.match(/^(.+?) v (.+)$/);
    return due ? { a: due[1], b: due[2] } : { heading: l };
  });
  const today = dayKey(start) === todayKey();
  return {
    kind: 'darts', sport: 'darts', league: 'PDC', id: `tsdb-${e.idEvent}`, name: e.strEvent.replace(/\s+/g, ' '),
    start, venue: [e.strVenue, e.strCity].filter(Boolean).join(', '), lines,
    state: today && lines.some((l) => l.a) ? 'in' : dayKey(start) > todayKey() || today ? 'pre' : 'post',
  };
}

async function loadDarts() {
  const res = await Promise.allSettled(['eventspastleague', 'eventsnextleague'].map((p) => getJSON(`${TSDB}/${p}.php?id=${DARTS_LEAGUE}`)));
  if (res.every((r) => r.status === 'rejected')) throw new Error('No darts data');
  const map = new Map();
  for (const r of res) for (const e of (r.status === 'fulfilled' && (r.value.events || r.value.results)) || []) map.set(e.idEvent, dartsEvent(e));
  return { events: [...map.values()] };
}

const LOADERS = { football: loadFootball, nfl: loadNFL, golf: loadGolf, f1: loadF1, ufc: loadUFC, boxing: loadBoxing, darts: loadDarts };

// ---------- tables ----------

const stat = (entry, ...names) => {
  for (const n of names) {
    const s = (entry.stats || []).find((x) => x.name === n || x.type === n || x.abbreviation === n);
    if (s) return s;
  }
  return null;
};
const sv = (entry, ...n) => stat(entry, ...n)?.displayValue ?? '';
const sn = (entry, ...n) => Number(stat(entry, ...n)?.value ?? 999);

async function loadTable(key) {
  if (key.startsWith('football:')) {
    const code = key.split(':')[1];
    const d = await getJSON(`${ESPN_V2}/soccer/${code}/standings`);
    const groups = d.children?.length ? d.children : [d];
    return groups.map((g) => ({
      name: g.name,
      rows: (g.standings?.entries || [])
        .slice()
        .sort((a, b) => sn(a, 'rank') - sn(b, 'rank'))
        .map((e) => ({
          name: e.team?.displayName, short: e.team?.shortDisplayName || e.team?.displayName,
          logo: e.team?.logos?.[0]?.href, note: e.note,
          p: sv(e, 'gamesPlayed'), w: sv(e, 'wins'), d: sv(e, 'ties'), l: sv(e, 'losses'),
          gd: sv(e, 'pointDifferential'), pts: sv(e, 'points'), rank: sv(e, 'rank'),
        })),
    }));
  }
  if (key === 'nfl') {
    const d = await getJSON(`${ESPN_V2}/football/nfl/standings`);
    return (d.children || []).map((g) => ({
      name: g.name,
      rows: (g.standings?.entries || [])
        .slice()
        .sort((a, b) => sn(a, 'playoffSeed') - sn(b, 'playoffSeed'))
        .map((e) => ({
          name: e.team?.displayName, short: e.team?.shortDisplayName || e.team?.displayName,
          logo: e.team?.logos?.[0]?.href, seed: sv(e, 'playoffSeed'),
          w: sv(e, 'wins'), l: sv(e, 'losses'), t: sv(e, 'ties'),
          pct: sv(e, 'winPercent'), diff: sv(e, 'pointDifferential', 'differential'), strk: sv(e, 'streak'),
        })),
    }));
  }
  if (key === 'f1:drivers') {
    const d = await getJSON(`${JOLPICA}/current/driverStandings.json`);
    return d.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
  }
  if (key === 'f1:teams') {
    const d = await getJSON(`${JOLPICA}/current/constructorStandings.json`);
    return d.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
  }
  if (key === 'f1:last') {
    const d = await getJSON(`${JOLPICA}/current/last/results.json`);
    return d.MRData?.RaceTable?.Races?.[0] || null;
  }
  if (key === 'ufc') {
    return getJSON('data/ufc-rankings.json');
  }
  return null;
}

// ---------- loading orchestration ----------

function activeSports() {
  return state.sport === 'all' ? SPORTS.slice(1).map((s) => s.id) : [state.sport];
}

async function refresh(force = false) {
  // A tab/sport switch mid-load must not be dropped: rerun once this load ends.
  if (state.loading) { state.again = true; return; }
  state.loading = true;
  $('#refresh').classList.add('spin');
  // News needs golf leaderboards for the Irish golfers card; Tables loads its own data.
  const wanted = state.tab === 'tables' ? [] : state.tab === 'news' ? activeSports().filter((s) => s === 'golf') : activeSports();
  await Promise.all([loadTV(), ...wanted.map(async (id) => {
    const cur = state.data[id];
    if (!force && cur && Date.now() - cur.at < 25e3) return;
    try {
      state.data[id] = { ...(await LOADERS[id]()), at: Date.now() };
    } catch (e) {
      state.data[id] = { events: cur?.events || [], error: e.message || 'Failed to load', at: Date.now() };
    }
  })]);
  if (state.tab === 'tables') {
    const key = tableKey();
    if (!['golf', 'boxing', 'darts'].includes(key) && (force || !state.tables[key] || Date.now() - state.tables[key].at > 5 * 60e3)) {
      try { state.tables[key] = { data: await loadTable(key), at: Date.now() }; }
      catch (e) { state.tables[key] = { error: e.message || 'Failed to load', at: Date.now() }; }
    }
  }
  if (state.tab === 'news' && (force || !state.news || Date.now() - state.news.at > 5 * 60e3)) {
    try { state.news = { ...(await loadNews()), at: Date.now() }; }
    catch (e) { state.news = { error: e.message || 'Failed to load', at: Date.now() }; }
  }
  if (state.match) await loadSummary(force);
  state.updated = new Date();
  state.loading = false;
  $('#refresh').classList.remove('spin');
  render();
  schedule();
  if (state.again) { state.again = false; refresh(); }
}

let timer;
function schedule() {
  clearTimeout(timer);
  const anyLive = Object.values(state.data).some((d) => d.events?.some((e) => e.state === 'in'))
    || sumComp()?.status?.type?.state === 'in';
  timer = setTimeout(() => refresh(true), anyLive ? 30e3 : 5 * 60e3);
}

// ---------- rendering: events ----------

const SPORT_LABEL = Object.fromEntries(SPORTS.map((s) => [s.id, s.label]));

function whenCell(e) {
  const t = e.text || '';
  if (e.state === 'in') return `<div class="when live">${esc(e.sport === 'football' ? (/^HT$/i.test(t) ? 'HT' : e.clock || 'LIVE') : 'LIVE')}</div>`;
  if (e.state === 'post') return `<div class="when">${esc(/AET|Pen|OT/i.test(t) ? t.replace(/^Final\//, '') : 'FT')}</div>`;
  if (/postponed|canceled|cancelled|delayed|suspended/i.test(e.text || '')) return `<div class="when">${esc(e.text)}</div>`;
  return `<div class="when">${esc(time(e.start))}</div>`;
}

function teamRow(t) {
  const fav = isFav(t.full) || isFav(t.name);
  return `<div class="team${t.winner ? ' win' : ''}${fav ? ' fav' : ''}">${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : ''}<span class="name">${esc(t.name)}</span></div>`;
}

function matchRow(e) {
  const showScore = e.state !== 'pre';
  const tv = e.state === 'pre' && e.sport === 'football' ? ukTV(e.start, e.sides[0]?.full, e.sides[1]?.full) : '';
  const meta = [e.state === 'in' && e.sport === 'nfl' ? e.text : '', e.note, tv && `📺 ${tv}`].filter(Boolean).join(' · ');
  return `<div class="match"${e.path ? ` data-match="${esc(`${e.path}/${e.id}`)}"` : ''}>
    ${whenCell(e)}
    <div class="teams">${e.sides.map(teamRow).join('')}</div>
    <div class="scores${e.state === 'in' ? ' live' : ''}">${showScore ? e.sides.map((s) => `<span>${esc(s.score ?? '')}</span>`).join('') : ''}</div>
    ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
    ${showScore ? scorerLines(e) : ''}
  </div>`;
}

// Scorers under live and finished matches: one line per team in row order, then NFL leaders.
function scorerLines(e) {
  const lines = [
    ...e.sides.filter((s) => s.inc).map((s) => `<span class="who">${esc(s.name)}</span> ${esc(s.inc)}`),
    ...(e.leaders || []).map(esc),
  ];
  return lines.length ? `<div class="meta inc">${lines.join('<br>')}</div>` : '';
}

function boardCard(e, limit = 10) {
  const golf = e.sport === 'golf';
  const rows = e.rows.slice(0, limit);
  const status = e.state === 'in' ? `<span class="dot"></span> ${esc(e.text || 'Live')}` : esc(e.text || dayLabel(e.start));
  return `<div class="card">
    <div class="board-head"><div class="ttl">${esc(e.name)}</div><div class="st${e.state === 'in' ? ' live' : ''}">${esc(e.league)} · ${status}</div></div>
    ${rows.length ? `<table>
      <thead><tr><th class="l">Pos</th><th class="l">${golf ? 'Player' : 'Driver'}</th>${golf ? '<th>To par</th><th>Thru / Tee</th><th class="hide-sm">Today</th>' : ''}</tr></thead>
      <tbody>${rows.map((r) => `<tr${isIrish(r) || isFav(r.name) ? ' class="fav"' : ''}><td class="l pos">${esc(r.pos)}</td><td class="l name-cell">${r.flag ? `<img src="${esc(r.flag)}" alt="">` : ''}${esc(r.name)}</td>${golf ? `<td class="pts">${esc(r.toPar)}</td><td>${esc(r.thru)}</td><td class="hide-sm">${esc(r.today)}</td>` : ''}</tr>`).join('')}</tbody>
    </table>` : '<div class="err">No leaderboard yet.</div>'}
  </div>`;
}

function cardCard(e, limit = 6) {
  const bouts = e.bouts.slice(0, limit);
  const status = e.state === 'in' ? `<span class="dot"></span> Live` : esc(e.state === 'post' ? 'Results' : `${dayLabel(e.start)} ${time(e.start)}`);
  return `<div class="card">
    <div class="board-head"><div class="ttl">${esc(e.name)}</div><div class="st${e.state === 'in' ? ' live' : ''}">${status}${e.venue ? ' · ' + esc(e.venue) : ''}</div></div>
    ${bouts.map((b) => `<div class="list-row"><div class="main"><div class="a">${b.aw ? '<b>' : ''}${esc(b.a)}${b.aw ? ' ✓</b>' : ''} vs ${b.bw ? '<b>' : ''}${esc(b.b)}${b.bw ? ' ✓</b>' : ''}</div><div class="b">${esc(b.cls)}</div></div><div class="side${b.state === 'in' ? ' live' : ''}">${esc(b.state === 'pre' ? '' : b.text)}</div></div>`).join('')}
    ${e.bouts.length > limit ? `<div class="hint">+ ${e.bouts.length - limit} more bouts</div>` : ''}
  </div>`;
}

function dartsCard(e) {
  const status = e.state === 'in' ? '<span class="dot"></span> Today' : esc(e.state === 'post' ? `Results · ${dayLabel(e.start)}` : dayLabel(e.start));
  const rows = e.lines.map((l) => {
    if (l.heading) return `<div class="list-row sub">${esc(l.heading)}</div>`;
    if (l.as == null) return `<div class="list-row"><div class="main"><div class="a">${esc(l.a)} v ${esc(l.b)}</div></div><div class="side">To play</div></div>`;
    const [w, x] = l.as > l.bs ? ['<b>', ''] : ['', '<b>'];
    const end = (t) => (t ? t.replace('<', '</') : '');
    return `<div class="list-row"><div class="main"><div class="a">${w}${esc(l.a)}${end(w)} ${l.as}–${l.bs} ${x}${esc(l.b)}${end(x)}</div></div><div class="side">FT</div></div>`;
  }).join('');
  return `<div class="card">
    <div class="board-head"><div class="ttl">${esc(e.name)}</div><div class="st${e.state === 'in' ? ' live' : ''}">${status}${e.venue ? ' · ' + esc(e.venue) : ''}</div></div>
    ${rows || '<div class="err">Draw not published yet.</div>'}
  </div>`;
}

function listRow(e) {
  let a = e.name, b = e.league, side = `${dayLabel(e.start)} ${time(e.start)}`;
  if (e.kind === 'session') { a = `${e.session}`; b = `${e.name}${e.venue ? ' · ' + e.venue : ''}`; side = time(e.start); }
  if (e.kind === 'fight') { b = [e.league, e.venue].filter(Boolean).join(' · '); side = e.state === 'post' ? (e.result ? 'Result' : 'Done') : time(e.start) || dayLabel(e.start); }
  if (e.kind === 'listing') {
    side = e.end && dayKey(e.end) !== dayKey(e.start) ? `${fmtDay.format(e.start)} – ${fmtDay.format(e.end)}` : `${dayLabel(e.start)}`;
  }
  return `<div class="list-row"><div class="main"><div class="a">${esc(a)}</div><div class="b">${esc(b)}</div>${e.kind === 'fight' && e.result ? `<div class="b">${esc(e.result.slice(0, 140))}</div>` : ''}</div><div class="side">${esc(side)}</div></div>`;
}

function renderEventCards(events, matchFn = matchRow) {
  const out = [];
  const rows = [];
  const flush = () => { if (rows.length) out.push(`<div class="card">${rows.splice(0).join('')}</div>`); };
  for (const e of events) {
    if (e.kind === 'match') rows.push(matchFn(e));
    else if (e.kind === 'board') { flush(); out.push(boardCard(e)); }
    else if (e.kind === 'card') { flush(); out.push(cardCard(e)); }
    else if (e.kind === 'darts') { flush(); out.push(dartsCard(e)); }
    else rows.push(listRow(e));
  }
  flush();
  return out.join('');
}

function section(title, sub, body) {
  return `<section class="section"><h2>${title}${sub ? ` <span class="sub">${esc(sub)}</span>` : ''}</h2>${body}</section>`;
}

const leagueOrder = (e) => {
  const i = FOOTBALL_LEAGUES.findIndex((l) => l.name === e.league);
  return i < 0 ? 0 : i;
};

function groupByLeague(events) {
  const g = new Map();
  for (const e of events) {
    const k = `${SPORTS.findIndex((s) => s.id === e.sport)}|${leagueOrder(e)}|${e.league}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(e);
  }
  return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([k, v]) => [k.split('|')[2], v.sort((x, y) => x.start - y.start)]);
}

function involvesFav(e) {
  if (e.kind === 'match') return e.sides.some((s) => isFav(s.full) || isFav(s.name));
  if (e.kind === 'card') return e.bouts.some((b) => isFav(b.a) || isFav(b.b)); // UFC fighters
  if (e.kind === 'board') return e.rows.some((r) => isFav(r.name)); // F1 drivers, golfers
  return false;
}

function errorsFor(sports) {
  return sports
    .filter((id) => state.data[id]?.error)
    .map((id) => `<div class="err">⚠︎ ${esc(SPORT_LABEL[id])}: couldn't load (${esc(state.data[id].error)}).</div>`)
    .join('');
}

function allEvents(sports) {
  return sports.flatMap((id) => state.data[id]?.events || []);
}

function renderLive() {
  const sports = activeSports();
  const live = allEvents(sports).filter((e) => e.state === 'in');
  if (!live.length) return errorsFor(sports) + `<div class="empty">Nothing live right now.<br>Check <b>Today</b> or <b>Upcoming</b>.</div>`;
  return errorsFor(sports) + groupByLeague(live).map(([lg, evs]) => section(`<span class="dot"></span> ${esc(lg)}`, '', renderEventCards(evs))).join('');
}

function isToday(e) {
  const t = todayKey();
  if (dayKey(e.start) === t) return true;
  // Multi-day events (golf) stay on Today while they're running.
  if (e.end && e.start <= new Date() && dayKey(e.end) >= t) return true;
  return e.state === 'in';
}

function renderToday() {
  const sports = activeSports();
  const evs = allEvents(sports).filter(isToday);
  if (!evs.length) return errorsFor(sports) + `<div class="empty">No events today.<br>See <b>Upcoming</b>.</div>`;
  const favs = evs.filter(involvesFav);
  let html = errorsFor(sports);
  if (favs.length) html += section('★ Your teams', '', renderEventCards(favs.sort((a, b) => a.start - b.start)));
  html += groupByLeague(evs).map(([lg, list]) => section(esc(lg), '', renderEventCards(list))).join('');
  return html;
}

function renderUpcoming() {
  const sports = activeSports();
  const now = new Date();
  const tKey = todayKey();
  const evs = allEvents(sports)
    .filter((e) => e.state === 'pre' && e.kind !== 'board' && dayKey(e.start) > tKey && e.start > now)
    .sort((a, b) => a.start - b.start);
  if (!evs.length) return errorsFor(sports) + `<div class="empty">No upcoming events found.</div>`;
  const favs = evs.filter(involvesFav).slice(0, 10);
  let html = errorsFor(sports);
  if (favs.length) html += section('★ Your teams', '', renderEventCards(favs, matchRowWithDay));
  // Group by day, then league.
  const days = new Map();
  for (const e of evs) {
    const k = dayKey(e.start);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(e);
  }
  for (const [, list] of [...days.entries()].slice(0, 21)) {
    const label = dayLabel(list[0].start);
    const body = groupByLeague(list).map(([lg, l]) => `<div class="hint" style="text-align:left;margin:8px 0 4px">${esc(lg)}</div>${renderEventCards(l)}`).join('');
    html += section(esc(label), '', body);
  }
  return html;
}

function matchRowWithDay(e) {
  // Prefix the day to the time/FT cell (live rows use class "when live" and stay as they are).
  return matchRow(e).replace(/<div class="when">(.*?)<\/div>/, (_, x) => `<div class="when">${esc(fmtDay.format(e.start).replace(/,/, ''))}<br>${x}</div>`);
}

// ---------- news ----------

const isIrish = (r) => IRISH_FLAGS.has(r.country);

const espnArticles = (d) => (d.articles || []).map((a) => ({ title: a.headline, url: a.links?.web?.href, date: a.published, desc: a.description, source: 'ESPN' }));

// Dedupe by headline, drop anything without a web link, newest first.
function mergeNews(...lists) {
  const seen = new Set();
  return lists.flat()
    .filter((a) => a?.title && /^https?:/.test(a.url || '') && !seen.has(a.title.toLowerCase()) && seen.add(a.title.toLowerCase()))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

async function loadNews() {
  const espn = (path, q = '') => getJSON(`${ESPN}/${path}/news?limit=25${q}`).then(espnArticles).catch(() => []);
  const [bbc, teams, general] = await Promise.all([
    getJSON('data/news.json').catch(() => ({})),
    // ESPN's /teams/{id} summary blocks browsers (no CORS), so position comes from standings
    // and last/next games from the schedule (results) + schedule?fixture=true (soccer fixtures).
    Promise.all(FOLLOW.map(async (t) => {
      const [res, fix, table, news, club] = await Promise.all([
        getJSON(`${ESPN}/${t.path}/teams/${t.id}/schedule`).catch(() => null),
        getJSON(`${ESPN}/${t.path}/teams/${t.id}/schedule?fixture=true`).catch(() => null),
        getJSON(`${ESPN_V2}/${t.path}/standings`).catch(() => null),
        espn(t.path, `&team=${t.id}`),
        t.club ? t.club().catch(() => []) : [],
      ]);
      const sched = [...(res?.events || []), ...(fix?.events || [])];
      await withScorers(t, sched);
      return { ...t, standing: standingLine(t, table), sched, news: [...news, ...club] };
    })),
    Promise.all(Object.entries(NEWS_PATHS).map(async ([s, paths]) => [s, (await Promise.all(paths.map((p) => espn(p)))).flat()])),
  ]);
  return { bbc: bbc.feeds || {}, teams, general: Object.fromEntries(general) };
}

// The team schedule feed has no goal details, so swap the last result for the same game from that
// day's scoreboard, which has scorers and NFL leaders. ESPN files late US games under the previous
// (US) day, so the day before is tried too.
async function withScorers(t, sched) {
  const last = sched.filter((e) => e.competitions?.[0]?.status?.type?.state === 'post')
    .sort((a, b) => new Date(a.date) - new Date(b.date)).pop();
  if (!last) return;
  for (const back of [0, 1]) {
    const day = ymd(new Date(new Date(last.date) - back * 864e5));
    const full = (await getJSON(`${ESPN}/${t.path}/scoreboard?dates=${day}`).catch(() => null))?.events?.find((e) => e.id === last.id);
    if (full) { sched[sched.indexOf(last)] = full; return; }
  }
}

const ordinal = (n) => (n ? `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}` : '');

// "21st in English League Two · 11 pts · W3 D2 L6" or "3rd seed in AFC · 4-2".
function standingLine(t, table) {
  const groups = table?.children?.length ? table.children : table ? [table] : [];
  for (const g of groups) {
    const e = g.standings?.entries?.find((x) => x.team?.id === String(t.id));
    if (!e) continue;
    if (t.sport === 'nfl') {
      const ties = sv(e, 'ties');
      return `${ordinal(Number(sv(e, 'playoffSeed')))} seed in ${g.abbreviation || g.name} · ${sv(e, 'wins')}-${sv(e, 'losses')}${ties && ties !== '0' ? `-${ties}` : ''}`;
    }
    return `${ordinal(Number(sv(e, 'rank')))} in ${(g.name || '').replace(/^\d{4}-\d{2,4}\s+/, '')} ·${sv(e, 'points')} pts · W${sv(e, 'wins')} D${sv(e, 'ties')} L${sv(e, 'losses')}`;
  }
  return '';
}

function ago(d) {
  const m = (Date.now() - new Date(d)) / 6e4;
  if (!(m >= 0)) return '';
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return fmtDay.format(new Date(d));
}

function newsCard(items, empty = 'No recent news.') {
  if (!items.length) return `<div class="hint">${empty}</div>`;
  return `<div class="card">${items.map((a) => `<a class="list-row" href="${esc(a.url)}" target="_blank" rel="noopener"><div class="main"><div class="a">${esc(a.title)}</div>${a.desc ? `<div class="b">${esc(a.desc.slice(0, 140))}</div>` : ''}</div><div class="side">${esc(ago(a.date))}<br>${esc(a.source)}</div></a>`).join('')}</div>`;
}

function teamNotes(t, bbc) {
  const evs = t.sched.map((ev) => espnMatch(ev, t.sport, t.name, t.sport === 'nfl', t.path)).sort((a, b) => a.start - b.start);
  const last = evs.filter((e) => e.state === 'post').pop();
  const next = evs.find((e) => e.state === 'in') || evs.find((e) => e.state === 'pre');
  const games = [last, next].filter(Boolean);
  // Club posts are all about the club; others must mention the team.
  const news = mergeNews(t.news, bbc[t.bbc] || []).filter((a) => a.official || t.match.test(`${a.title} ${a.desc}`)).slice(0, t.club ? 8 : 5);
  return (games.length ? renderEventCards(games, matchRowWithDay) : '') + `<div style="height:8px"></div>` + newsCard(news);
}

function irishNotes(n) {
  const g = state.data.golf;
  const rows = (g?.events || []).filter((e) => e.kind === 'board')
    .flatMap((b) => b.rows.filter(isIrish).map((r) => ({ ...r, event: b.name, live: b.state === 'in' })));
  const playing = !g ? '<div class="empty">Loading…</div>'
    : rows.length ? `<div class="card">${rows.map((r) => `<div class="list-row"><div class="main"><div class="a">${esc(r.name)}</div><div class="b">${esc(r.event)}</div></div><div class="side${r.live ? ' live' : ''}">${esc(r.pos)} · ${esc(r.toPar)}${r.thru === '' ? '' : /:/.test(r.thru) ? ` · tees off ${esc(r.thru)}` : /^\d+$/.test(r.thru) ? ` · thru ${esc(r.thru)}` : ` · ${esc(r.thru)}`}</div></div>`).join('')}</div>`
    : '<div class="hint">No Irish golfers in this week\'s PGA or DP World Tour fields.</div>';
  const news = mergeNews(n.general.golf || [], n.bbc.golf || []).filter((a) => IRISH_NEWS.test(`${a.title} ${a.desc}`)).slice(0, 5);
  return playing + `<div style="height:8px"></div>` + newsCard(news, 'No recent news about Irish golfers.');
}

function renderNews() {
  const n = state.news;
  if (n.error) return `<div class="err">⚠︎ Couldn't load news (${esc(n.error)}).</div>`;
  const sports = activeSports();
  let html = '';
  for (const t of n.teams.filter((x) => sports.includes(x.sport))) {
    html += section(`★ ${esc(t.name)}`, t.standing, teamNotes(t, n.bbc));
    // Kept in the forum's own order (most recently active first); the time shown is when the thread started.
    if (t.forum) html += section(`💬 ${esc(t.name.split(' ')[0])} fan forum`, 'Fan opinion, not verified news', newsCard((n.bbc[t.forum] || []).slice(0, 6), 'Forum not available.'));
  }
  if (sports.includes('golf')) html += section('★ Irish golfers', '', irishNotes(n));
  for (const s of sports) {
    html += section(`${esc(SPORT_LABEL[s])} news`, '', newsCard(mergeNews(n.general[s] || [], n.bbc[BBC_FOR_SPORT[s]] || []).slice(0, 6)));
  }
  return html;
}

// ---------- rendering: tables ----------

const TABLE_SUBS = {
  football: FOOTBALL_LEAGUES.filter((l) => l.table).map((l) => ({ id: `football:${l.code}`, label: l.name })),
  nfl: [{ id: 'nfl', label: 'Conferences' }],
  golf: [{ id: 'golf', label: 'Leaderboard' }],
  f1: [{ id: 'f1:drivers', label: 'Drivers' }, { id: 'f1:teams', label: 'Constructors' }, { id: 'f1:last', label: 'Last race' }],
  ufc: [{ id: 'ufc', label: 'Rankings' }],
  boxing: [{ id: 'boxing', label: 'Results' }],
  darts: [{ id: 'darts', label: 'Results' }],
};

function tableSportId() {
  return state.sport === 'all' ? state.tableSport : state.sport;
}

function tableKey() {
  const sp = tableSportId();
  const subs = TABLE_SUBS[sp];
  const chosen = state.sub[sp];
  return subs.some((s) => s.id === chosen) ? chosen : subs[0].id;
}

function favRowAttrs(name) {
  return `data-fav="${esc(name)}" class="${isFav(name) ? 'fav' : ''}"`;
}

function renderFootballTable(groups) {
  return groups.map((g) => {
    const notes = new Map();
    const rows = g.rows.map((r) => {
      if (r.note?.description) notes.set(r.note.description, r.note.color);
      const c = r.note?.color ? `style="border-left-color:${esc(r.note.color.startsWith('#') ? r.note.color : '#' + r.note.color)}"` : '';
      return `<tr ${favRowAttrs(r.name)}><td class="l pos" ${c}>${esc(r.rank)}</td><td class="l name-cell">${r.logo ? `<img src="${esc(r.logo)}" alt="">` : ''}${esc(r.short)}</td><td>${esc(r.p)}</td><td class="hide-sm">${esc(r.w)}</td><td class="hide-sm">${esc(r.d)}</td><td class="hide-sm">${esc(r.l)}</td><td>${esc(r.gd)}</td><td class="pts">${esc(r.pts)}</td></tr>`;
    }).join('');
    const legend = notes.size ? `<div class="legend">${[...notes].map(([d, c]) => `<span style="--c:${esc(c?.startsWith('#') ? c : '#' + c)}">${esc(d)}</span>`).join('')}</div>` : '';
    return `<div class="card"><table><thead><tr><th class="l">#</th><th class="l">Team</th><th>P</th><th class="hide-sm">W</th><th class="hide-sm">D</th><th class="hide-sm">L</th><th>GD</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table>${legend}</div>`;
  }).join('');
}

function renderNFLTable(groups) {
  return groups.map((g) => section(esc(g.name), 'by playoff seed', `<div class="card"><table><thead><tr><th class="l">#</th><th class="l">Team</th><th>W</th><th>L</th><th class="hide-sm">T</th><th>PCT</th><th class="hide-sm">Diff</th><th class="hide-sm">Strk</th></tr></thead><tbody>${
    g.rows.map((r) => `<tr ${favRowAttrs(r.name)}><td class="l pos" ${Number(r.seed) <= 7 ? 'style="border-left-color:var(--win)"' : ''}>${esc(r.seed)}</td><td class="l name-cell">${r.logo ? `<img src="${esc(r.logo)}" alt="">` : ''}${esc(r.short)}</td><td>${esc(r.w)}</td><td>${esc(r.l)}</td><td class="hide-sm">${esc(r.t)}</td><td>${esc(r.pct)}</td><td class="hide-sm">${esc(r.diff)}</td><td class="hide-sm">${esc(r.strk)}</td></tr>`).join('')
  }</tbody></table><div class="legend"><span style="--c:var(--win)">Playoff place</span></div></div>`)).join('');
}

function renderF1Table(key, data) {
  if (key === 'f1:drivers') {
    return `<div class="card"><table><thead><tr><th class="l">#</th><th class="l">Driver</th><th class="l hide-sm">Team</th><th>Wins</th><th>Pts</th></tr></thead><tbody>${
      data.map((d) => { const n = `${d.Driver?.givenName} ${d.Driver?.familyName}`; return `<tr ${favRowAttrs(n)}><td class="l pos">${esc(d.position ?? d.positionText)}</td><td class="l name-cell">${esc(n)}</td><td class="l hide-sm">${esc(d.Constructors?.[0]?.name)}</td><td>${esc(d.wins)}</td><td class="pts">${esc(d.points)}</td></tr>`; }).join('')
    }</tbody></table></div>`;
  }
  if (key === 'f1:teams') {
    return `<div class="card"><table><thead><tr><th class="l">#</th><th class="l">Constructor</th><th>Wins</th><th>Pts</th></tr></thead><tbody>${
      data.map((d) => `<tr ${favRowAttrs(d.Constructor?.name)}><td class="l pos">${esc(d.position ?? d.positionText)}</td><td class="l name-cell">${esc(d.Constructor?.name)}</td><td>${esc(d.wins)}</td><td class="pts">${esc(d.points)}</td></tr>`).join('')
    }</tbody></table></div>`;
  }
  if (!data) return '<div class="empty">No result yet.</div>';
  return section(esc(data.raceName), `${data.date || ''}`, `<div class="card"><table><thead><tr><th class="l">#</th><th class="l">Driver</th><th class="l hide-sm">Team</th><th>Time</th><th>Pts</th></tr></thead><tbody>${
    (data.Results || []).map((r) => { const n = `${r.Driver?.givenName} ${r.Driver?.familyName}`; return `<tr ${favRowAttrs(n)}><td class="l pos">${esc(r.positionText)}</td><td class="l name-cell">${esc(n)}</td><td class="l hide-sm">${esc(r.Constructor?.name)}</td><td>${esc(r.Time?.time || r.status)}</td><td class="pts">${esc(r.points)}</td></tr>`; }).join('')
  }</tbody></table></div>`);
}

function renderUFCRankings(data) {
  if (!data?.divisions?.length) return '<div class="empty">Rankings not available yet.</div>';
  return data.divisions.map((d) => section(esc(d.name), d.champion ? `Champion: ${d.champion}` : '', `<div class="card">${
    (d.fighters || []).slice(0, 15).map((f) => `<div data-fav="${esc(f.name)}" class="list-row${isFav(f.name) ? ' fav' : ''}"><div class="main"><div class="a">${esc(f.name)}</div></div><div class="side">#${esc(f.rank)}</div></div>`).join('')
  }</div>`)).join('') + (data.updated ? `<div class="updated">Rankings from ufc.com · ${esc(new Date(data.updated).toLocaleDateString('en-GB'))}</div>` : '');
}

function renderTables() {
  const sp = tableSportId();
  const key = tableKey();
  let html = '';
  if (state.sport === 'all') {
    html += `<div class="seg" data-role="tsport">${SPORTS.slice(1).map((s) => `<button data-v="${s.id}" class="${s.id === sp ? 'on' : ''}">${s.label}</button>`).join('')}</div>`;
  }
  const subs = TABLE_SUBS[sp];
  if (subs.length > 1) html += `<div class="seg" data-role="sub">${subs.map((s) => `<button data-v="${s.id}" class="${s.id === key ? 'on' : ''}">${esc(s.label)}</button>`).join('')}</div>`;

  // Golf, boxing and darts reuse the event feeds rather than a standings endpoint.
  if (sp === 'golf' || sp === 'boxing' || sp === 'darts') {
    const d = state.data[sp];
    if (!d) { ensureLoaded(sp); return html + '<div class="empty">Loading…</div>'; }
    if (d.error) return html + `<div class="err">⚠︎ ${esc(d.error)}</div>`;
    if (sp === 'golf') {
      const boards = d.events.filter((e) => e.kind === 'board');
      return html + (boards.length ? boards.map((b) => boardCard(b, 200)).join('') : '<div class="empty">No tournament leaderboard right now.</div>') +
        '<div class="hint">Season-long FedEx Cup / world rankings aren\'t available from a free source.</div>';
    }
    if (sp === 'darts') {
      return html + renderEventCards(d.events.slice().sort((a, b) => b.start - a.start)) +
        '<div class="hint">PDC Order of Merit isn\'t available from a free source.</div>';
    }
    const past = d.events.filter((e) => e.state === 'post').sort((a, b) => b.start - a.start);
    return html + '<div class="hint">Boxing has no league table — recent results below.</div>' +
      (past.length ? `<div class="card">${past.map(listRow).join('')}</div>` : '<div class="empty">No recent results.</div>');
  }

  const t = state.tables[key];
  if (!t) return html + '<div class="empty">Loading…</div>';
  if (t.error) return html + `<div class="err">⚠︎ Couldn't load table (${esc(t.error)}).</div>`;
  if (sp === 'football') html += renderFootballTable(t.data);
  else if (sp === 'nfl') html += renderNFLTable(t.data);
  else if (sp === 'f1') html += renderF1Table(key, t.data);
  else if (sp === 'ufc') html += renderUFCRankings(t.data);
  html += '<div class="hint">Tap a team or driver to mark it as a favourite ★</div>';
  return html;
}

const pendingLoads = new Set();
function ensureLoaded(id) {
  if (pendingLoads.has(id)) return;
  pendingLoads.add(id);
  LOADERS[id]()
    .then((d) => { state.data[id] = { ...d, at: Date.now() }; })
    .catch((e) => { state.data[id] = { events: [], error: e.message, at: Date.now() }; })
    .finally(() => { pendingLoads.delete(id); render(); });
}

// ---------- UK TV (football) ----------
// data/tv.json is rebuilt every 3 hours from live-footballontv.com (scripts/tv.mjs); ESPN only lists US channels.
// A team plays at most once a day, so UK date + either team identifies the game.

// The listings use short names for a few clubs (checked against all 92 league clubs, Oct 2026).
const TV_ALIASES = { 'mk dons': 'milton keynes dons', qpr: 'queens park rangers', 'west brom': 'west bromwich albion', wolves: 'wolverhampton wanderers' };
const teamKey = (n) => {
  const k = String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(afc|fc)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return TV_ALIASES[k] || k;
};

async function loadTV() {
  if (state.tv && Date.now() - state.tv.at < 30 * 60e3) return;
  try {
    const d = await getJSON('data/tv.json');
    const index = new Map();
    for (const f of d.fixtures || []) for (const t of [f.home, f.away]) index.set(`${f.date}|${teamKey(t)}`, f.channels);
    state.tv = { data: d, index, lastDay: d.fixtures?.at(-1)?.date || '', at: Date.now() };
  } catch {
    state.tv = { at: Date.now() }; // no listings: rows just show no channel
  }
}

/** UK channels for a football match, e.g. "Sky Sports Main Event, Sky Sports Premier League". Lists show the first two. */
function ukTV(start, home, away, all = false) {
  const idx = state.tv?.index;
  if (!idx || isNaN(start)) return '';
  const day = dayKey(start);
  const ch = idx.get(`${day}|${teamKey(home)}`) || idx.get(`${day}|${teamKey(away)}`);
  if (!ch) return '';
  return all || ch.length <= 2 ? ch.join(', ') : `${ch.slice(0, 2).join(', ')} +${ch.length - 2}`;
}

// ---------- match page (tap a football or NFL game) ----------
// Everything comes from ESPN's per-match summary, fetched when the page opens and every 30s while live.

const MATCH_PATH = /^(soccer\/[a-z0-9._]+|football\/nfl)$/; // only leagues we know, never arbitrary URLs

function openFromHash() {
  const parts = decodeURIComponent(location.hash.slice(1)).split('/');
  const id = parts.pop(), path = parts.slice(1).join('/');
  const ok = parts[0] === 'match' && /^\d+$/.test(id) && MATCH_PATH.test(path);
  if (!ok) { if (state.match) { state.match = null; state.pushedMatch = false; renderSheet(); } return; }
  if (state.match?.id === id) return;
  state.match = { path, id, tab: null };
  $('#sheet').scrollTop = 0;
  renderSheet();
  loadSummary().then(() => { renderSheet(); schedule(); });
}

function closeMatch() {
  // Tapping a game pushed a history entry, so Back (browser, Android) and ← behave the same.
  // Opened from a saved link there's nothing to go back to, so just clear the hash.
  if (state.pushedMatch) { state.pushedMatch = false; history.back(); return; }
  history.replaceState(null, '', location.pathname + location.search);
  state.match = null;
  renderSheet();
}

async function loadSummary(force = false) {
  const m = state.match;
  if (!m) return;
  const key = `${m.path}/${m.id}`;
  if (!force && state.sum?.key === key && !state.sum.error && Date.now() - state.sum.at < 25e3) return;
  try {
    const data = await getJSON(`${ESPN}/${m.path}/summary?event=${m.id}`);
    state.sum = { key, data, at: Date.now() };
  } catch (e) {
    state.sum = { key, error: e.message || 'Failed to load', at: Date.now() };
  }
}

const sumData = () => (state.match && state.sum?.key === `${state.match.path}/${state.match.id}` ? state.sum : null);
const sumComp = () => sumData()?.data?.header?.competitions?.[0];
const isNFL = () => state.match?.path === 'football/nfl';

function renderSheet() {
  const el = $('#sheet');
  document.body.classList.toggle('sheet-open', !!state.match);
  if (!state.match) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const s = sumData();
  let html = `<div class="sheet-top"><button class="icon-btn" data-close aria-label="Back">←</button><div class="sheet-ttl">${isNFL() ? 'NFL' : 'Match'}</div></div><div class="sheet-body">`;
  if (!s) html += '<div class="empty">Loading…</div>';
  else if (s.error) html += `<div class="err">⚠︎ Couldn't load this match (${esc(s.error)}).</div>`;
  else {
    const d = s.data, comp = sumComp() || {};
    const tabs = isNFL() ? nflTabs(d, comp) : footballTabs(d, comp);
    const tab = tabs.find((t) => t.id === state.match.tab) || tabs.find((t) => t.def) || tabs[0];
    html += matchHeader(d, comp) +
      `<div class="seg mtabs">${tabs.map((t) => `<button data-mtab="${t.id}" class="${t.id === tab.id ? 'on' : ''}">${t.label}</button>`).join('')}</div>` +
      tab.render();
  }
  el.innerHTML = html + '</div>';
}

// Home first for football, away first for NFL (matching the lists).
function orderedSides(comp) {
  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home') || cs[0], away = cs.find((c) => c.homeAway === 'away') || cs[1];
  return isNFL() ? [away, home] : [home, away];
}
const teamShort = (t = {}) => t.shortDisplayName || t.abbreviation || t.displayName || '';
const logoOf = (t = {}) => t.logos?.[0]?.href || t.logo;

function matchHeader(d, comp) {
  const st = comp.status?.type || {};
  const sides = orderedSides(comp);
  const pre = st.state === 'pre';
  const start = new Date(comp.date);
  const team = (c) => `<div class="mh-team">${logoOf(c?.team) ? `<img src="${esc(logoOf(c.team))}" alt="">` : ''}<div>${esc(teamShort(c?.team))}</div></div>`;
  const status = st.state === 'in' ? `<span class="dot"></span> ${esc(st.shortDetail || 'Live')}` : esc(pre ? `${dayLabel(start)} ${time(start)}` : st.shortDetail || 'FT');
  const venue = d.gameInfo?.venue?.fullName;
  return `<div class="card mh">
    ${team(sides[0])}
    <div class="mh-score${st.state === 'in' ? ' live' : ''}">${pre ? 'v' : `${esc(sides[0]?.score ?? '')} – ${esc(sides[1]?.score ?? '')}`}</div>
    ${team(sides[1])}
    <div class="mh-st${st.state === 'in' ? ' live' : ''}">${status}${venue ? ` · ${esc(venue)}` : ''}</div>
  </div>`;
}

const hint = (t) => `<div class="hint">${t}</div>`;
const row = (a, b, side = '', cls = '') => `<div class="list-row${cls}"><div class="main"><div class="a">${a}</div>${b ? `<div class="b">${b}</div>` : ''}</div><div class="side">${side}</div></div>`;

// ----- football -----

function footballTabs(d, comp) {
  const st = comp.status?.type?.state;
  const hasLineups = (d.rosters || []).some((r) => r.roster?.length);
  return [
    { id: 'lineups', label: 'Line-ups', def: st === 'pre' && hasLineups, render: () => lineupsTab(d) },
    { id: 'timeline', label: 'Timeline', def: st !== 'pre', render: () => timelineTab(d, comp) },
    { id: 'stats', label: 'Stats', render: () => statsTab(d) },
    { id: 'commentary', label: 'Commentary', render: () => commentaryTab(d) },
    { id: 'info', label: 'Info', def: st === 'pre' && !hasLineups, render: () => infoTab(d, comp) },
  ];
}

function lineupsTab(d) {
  const rosters = (d.rosters || []).slice().sort((a, b) => (a.homeAway === 'home' ? -1 : 1) - (b.homeAway === 'home' ? -1 : 1));
  if (!rosters.some((r) => r.roster?.length)) return hint('Line-ups usually appear about an hour before kick-off.');
  return rosters.map((r) => {
    const players = r.roster || [];
    const starters = players.filter((p) => p.starter).sort((a, b) => Number(a.formationPlace || 99) - Number(b.formationPlace || 99));
    const bench = players.filter((p) => !p.starter);
    const marks = (p) => (p.plays || []).map((pl) => {
      const m = pl.clock?.displayValue || '';
      if (pl.redCard) return `🟥 ${m}`;
      if (pl.yellowCard) return `🟨 ${m}`;
      // A goal appears on both the scorer (didScore) and the assister (didAssist).
      if (pl.didScore) return `⚽${pl.ownGoal ? ' og' : pl.penaltyKick ? ' pen' : ''} ${m}`;
      if (pl.didAssist) return `🅰️ ${m}`;
      if (pl.substitution) return `${p.starter ? '↓' : '↑'} ${m}`;
      return '';
    }).filter(Boolean).join(' ');
    const player = (p) => row(
      `<span class="num">${esc(p.jersey ?? '')}</span> ${esc(p.athlete?.displayName || '')}`,
      '', `${esc(marks(p))}${p.position?.abbreviation ? ` <span class="pos">${esc(p.position.abbreviation)}</span>` : ''}`,
      p.starter || p.subbedIn ? '' : ' dim',
    );
    return `<div class="card">
      <div class="board-head"><div class="ttl">${esc(r.team?.displayName || '')}</div><div class="st">${esc(r.formation || '')}</div></div>
      ${starters.map(player).join('')}
      ${bench.length ? `<div class="list-row sub">Substitutes</div>${bench.map(player).join('')}` : ''}
    </div>`;
  }).join('') + hint('⚽ goal · 🅰️ assist · 🟨 booked · 🟥 sent off · ↓ subbed off · ↑ came on');
}

function timelineTab(d, comp) {
  const shortById = Object.fromEntries((comp.competitors || []).map((c) => [c.team?.id, teamShort(c.team)]));
  const PHASE = { Kickoff: 'Kick-off', Halftime: 'Half-time', 'Start 2nd Half': 'Second half', 'End Regular Time': 'Full-time', 'Start Extra Time': 'Extra time', 'End Extra Time': 'End of extra time' };
  const rows = (d.keyEvents || []).map((k) => {
    const type = k.type?.text || '';
    const min = esc(k.clock?.displayValue || '');
    const who = (i) => esc(k.participants?.[i]?.athlete?.displayName || '');
    const team = esc(shortById[k.team?.id] || k.team?.displayName || '');
    if (PHASE[type]) return `<div class="list-row sub"><div class="main">${PHASE[type]}</div><div class="side">${min}</div></div>`;
    if (type.startsWith('Goal') || k.scoringPlay) {
      const assist = k.participants?.[1] ? ` · assist ${who(1)}` : '';
      const kind = /own goal/i.test(type) ? ' (og)' : /penalty/i.test(type) ? ' (pen)' : '';
      return row(`⚽ ${who(0)}${kind}`, `${team}${assist}`, min);
    }
    if (type === 'Red Card') return row(`🟥 ${who(0)}`, team, min);
    if (type === 'Yellow Card') return row(`🟨 ${who(0)}`, team, min);
    if (type === 'Substitution') return row(`🔄 ${who(0)} <span class="muted">for</span> ${who(1)}`, team, min);
    if (/penalty/i.test(type)) return row(`⚪ ${esc(type)}`, `${team}${who(0) ? ` · ${who(0)}` : ''}`, min); // missed / saved pens
    return '';
  }).filter(Boolean);
  return rows.length ? `<div class="card">${rows.join('')}</div>` : hint('The timeline starts at kick-off.');
}

const FOOTBALL_STATS = [
  ['possessionPct', 'Possession', '%'], ['totalShots', 'Shots'], ['shotsOnTarget', 'On target'], ['wonCorners', 'Corners'],
  ['totalPasses', 'Passes'], ['passAcc', 'Pass accuracy', '%'], ['totalTackles', 'Tackles'], ['interceptions', 'Interceptions'],
  ['saves', 'Saves'], ['foulsCommitted', 'Fouls'], ['offsides', 'Offsides'], ['yellowCards', 'Yellow cards'], ['redCards', 'Red cards'],
];

function statsTab(d) {
  const teams = (d.boxscore?.teams || []).slice().sort((a, b) => (a.homeAway === 'away') - (b.homeAway === 'away'));
  if (teams.length < 2) return hint('Stats appear once the match starts.');
  const val = (t, name) => {
    const by = (n) => t.statistics?.find((s) => s.name === n);
    if (name === 'passAcc') { const a = +by('accuratePasses')?.displayValue, n = +by('totalPasses')?.displayValue; return n ? Math.round((a / n) * 100) : null; }
    const s = by(name);
    return s ? s.displayValue : null;
  };
  const head = `<div class="stat-head"><span>${esc(teamShort(teams[0].team))}</span><span>${esc(teamShort(teams[1].team))}</span></div>`;
  // Before kick-off ESPN sends season totals instead (goals for/against etc.): list those as they come.
  if (val(teams[0], 'possessionPct') == null) {
    const rows = (teams[0].statistics || []).map((s, i) => statRow(s.label, s.displayValue, teams[1].statistics?.[i]?.displayValue));
    return `<div class="card stats">${head}${rows.join('')}</div>` + hint('Season so far. Match stats appear once it starts.');
  }
  const rows = FOOTBALL_STATS.map(([name, label, unit = '']) => {
    const a = val(teams[0], name), b = val(teams[1], name);
    return a == null || b == null ? '' : statRow(label, `${a}${unit}`, `${b}${unit}`);
  });
  return `<div class="card stats">${head}${rows.join('')}</div>`;
}

function statRow(label, a, b) {
  const x = parseFloat(a) || 0, y = parseFloat(b) || 0;
  const pa = x + y ? Math.round((x / (x + y)) * 100) : 50;
  return `<div class="stat"><span class="sv${x > y ? ' lead' : ''}">${esc(a ?? '')}</span><span class="sl">${esc(label)}</span><span class="sv${y > x ? ' lead' : ''}">${esc(b ?? '')}</span>
    <div class="bar"><i style="width:${pa}%"></i><i style="width:${100 - pa}%"></i></div></div>`;
}

function commentaryTab(d) {
  const items = (d.commentary || []).slice().reverse(); // newest first
  if (!items.length) return hint('Commentary starts around kick-off.');
  return `<div class="card">${items.map((c) => row(esc(c.text || ''), '', esc(c.time?.displayValue || ''), ' comm')).join('')}</div>`;
}

function infoTab(d, comp) {
  let html = '';
  // Venue, attendance, TV
  // UK TV: football from data/tv.json; NFL has no free UK listings, but every game is on DAZN.
  const [h, a] = (() => { const cs = comp.competitors || []; return ['home', 'away'].map((s) => cs.find((c) => c.homeAway === s)?.team?.displayName); })();
  const tv = isNFL() ? 'Every game live on DAZN (NFL Game Pass); selected games on Sky Sports NFL'
    : ukTV(new Date(comp.date), h, a, true) ||(state.tv?.data && dayKey(new Date(comp.date)) <= state.tv.lastDay ? 'Not on UK TV' : '');
  const facts = [
    d.gameInfo?.venue?.fullName && ['Venue', [d.gameInfo.venue.fullName, d.gameInfo.venue.address?.city].filter(Boolean).join(', ')],
    d.gameInfo?.attendance && ['Attendance', Number(d.gameInfo.attendance).toLocaleString('en-GB')],
    tv && ['UK TV', tv],
    comp.date && ['Kick-off', `${fmtDay.format(new Date(comp.date))} ${time(new Date(comp.date))}`],
  ].filter(Boolean);
  if (facts.length) html += section('Match', '', `<div class="card">${facts.map(([k, v]) => row(esc(v), '', esc(k), ' fact')).join('')}</div>`);

  // Form: last five results each
  if (d.lastFiveGames?.length) {
    html += section('Form', 'last 5, most recent on the right', `<div class="card">${d.lastFiveGames.map((t) => {
      const evs = (t.events || []).slice().sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate)); // oldest → newest, left to right
      const pills = evs.map((e) => `<span class="pill ${esc((e.gameResult || '').toLowerCase())}" title="${esc(`${e.atVs} ${e.opponent?.displayName || ''} ${e.score}`)}">${esc(e.gameResult || '?')}</span>`).join('');
      const detail = evs.map((e) => `${e.score} ${e.atVs === '@' ? '@' : 'v'} ${e.opponent?.abbreviation || ''}`).join(' · ');
      return row(`${esc(t.team?.displayName || '')} <span class="pills">${pills}</span>`, esc(detail));
    }).join('')}</div>`);
  }

  // Head-to-head
  const series = d.seasonseries?.[0];
  if (series?.events?.length) {
    html += section('Head-to-head', series.summary || '', `<div class="card">${series.events.slice(0, 6).map((e) => {
      const cs = (e.competitors || []);
      const line = cs.map((c) => `${c.team?.abbreviation || ''} ${c.score ?? ''}`).join(' – ');
      return row(esc(line), '', esc((e.date || '').slice(0, 10).split('-').reverse().join('/')));
    }).join('')}</div>`);
  }

  html += miniTable(d, comp);
  return html || hint('No extra info for this match yet.');
}

// The league table around both teams (two places either side of each); the whole division for NFL.
function miniTable(d, comp) {
  const group = d.standings?.groups?.[0];
  const entries = group?.standings?.entries || [];
  if (!entries.length) return '';
  const names = (comp.competitors || []).flatMap((c) => [c.team?.displayName, c.team?.location, c.team?.shortDisplayName, c.team?.name]).filter(Boolean);
  const mine = (e) => names.includes(e.team) || names.includes(e.team?.displayName);
  const stat = (e, n) => e.stats?.find((s) => s.name === n || s.type === n)?.displayValue ?? '';
  const idx = entries.map((e, i) => (mine(e) ? i : -1)).filter((i) => i >= 0);
  const keep = isNFL() ? entries.map((_, i) => i) : entries.map((_, i) => i).filter((i) => idx.some((j) => Math.abs(i - j) <= 2));
  const head = isNFL() ? '<th class="l">#</th><th class="l">Team</th><th>W-L</th><th>PCT</th>' : '<th class="l">#</th><th class="l">Team</th><th>P</th><th>GD</th><th>Pts</th>';
  const body = keep.map((i) => {
    const e = entries[i];
    const name = esc(typeof e.team === 'string' ? e.team : e.team?.displayName || '');
    const cells = isNFL() ? `<td>${esc(stat(e, 'overall'))}</td><td>${esc(stat(e, 'winPercent'))}</td>`
      : `<td>${esc(stat(e, 'gamesPlayed'))}</td><td>${esc(stat(e, 'pointDifferential'))}</td><td class="pts">${esc(stat(e, 'points'))}</td>`;
    return `<tr class="${mine(e) ? 'hl' : ''}"><td class="l pos">${isNFL() ? i + 1 : esc(stat(e, 'rank') || i + 1)}</td><td class="l name-cell">${name}</td>${cells}</tr>`;
  }).join('');
  return section('Table', group.header || '', `<div class="card"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
}

// ----- NFL -----

function nflTabs(d, comp) {
  const st = comp.status?.type?.state;
  return [
    { id: 'scoring', label: 'Scoring', def: st !== 'pre', render: () => nflScoringTab(d, comp) },
    { id: 'stats', label: 'Stats', render: () => nflStatsTab(d) },
    { id: 'players', label: 'Players', render: () => nflPlayersTab(d) },
    { id: 'info', label: 'Info', def: st === 'pre', render: () => nflInfoTab(d, comp) },
  ];
}

function nflScoringTab(d, comp) {
  const sides = orderedSides(comp);
  const qs = Math.max(4, ...sides.map((c) => c?.linescores?.length || 0));
  const qName = (i) => (i < 4 ? `Q${i + 1}` : 'OT');
  const box = sides.some((c) => c?.linescores?.length) ? `<div class="card"><table><thead><tr><th class="l">Team</th>${[...Array(qs)].map((_, i) => `<th>${qName(i)}</th>`).join('')}<th>T</th></tr></thead><tbody>${
    sides.map((c) => `<tr><td class="l name-cell">${esc(teamShort(c?.team))}</td>${[...Array(qs)].map((_, i) => `<td>${esc(c?.linescores?.[i]?.displayValue ?? '')}</td>`).join('')}<td class="pts">${esc(c?.score ?? '')}</td></tr>`).join('')
  }</tbody></table></div>` : '';
  const plays = d.scoringPlays || [];
  if (!plays.length) return box + hint('Scoring plays appear once the game starts.');
  const [aw, hm] = sides;
  const byQ = new Map();
  for (const p of plays) { const q = p.period?.number || 0; if (!byQ.has(q)) byQ.set(q, []); byQ.get(q).push(p); }
  return box + [...byQ].map(([q, list]) => section(q > 4 ? 'Overtime' : `Quarter ${q}`, '', `<div class="card">${list.map((p) =>
    row(`<b>${esc(p.team?.abbreviation || '')}</b> ${esc(p.scoringType?.abbreviation || '')} · ${esc(p.text || '')}`,
      esc(`${p.clock?.displayValue || ''} · ${teamShort(aw?.team)} ${p.awayScore}–${p.homeScore} ${teamShort(hm?.team)}`))).join('')}</div>`)).join('');
}

function nflStatsTab(d) {
  const teams = d.boxscore?.teams || []; // ESPN lists away then home, like our rows
  if (teams.length < 2 || !teams[0].statistics?.length) return hint('Team stats appear once the game starts.');
  const head = `<div class="stat-head"><span>${esc(teamShort(teams[0].team))}</span><span>${esc(teamShort(teams[1].team))}</span></div>`;
  return `<div class="card stats">${head}${teams[0].statistics.map((s, i) => statRow(s.label, s.displayValue, teams[1].statistics[i]?.displayValue)).join('')}</div>`;
}

function nflPlayersTab(d) {
  const groups = d.boxscore?.players || [];
  if (!groups.length) return hint('Player stats appear once the game starts.');
  const CATS = { passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving', defensive: 'Defence', kicking: 'Kicking' };
  return groups.map((g) => section(esc(g.team?.displayName || ''), '', (g.statistics || []).filter((c) => CATS[c.name] && c.athletes?.length).map((c) =>
    `<div class="card"><table><thead><tr><th class="l">${CATS[c.name]}</th>${(c.labels || []).slice(0, 5).map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${
      c.athletes.slice(0, c.name === 'defensive' ? 5 : 4).map((a) => `<tr><td class="l name-cell">${esc(a.athlete?.displayName || '')}</td>${(a.stats || []).slice(0, 5).map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')
    }</tbody></table></div>`).join(''))).join('');
}

function nflInfoTab(d, comp) {
  let html = infoTab({ ...d, standings: null, seasonseries: null }, comp); // venue, TV, kick-off
  if (html.includes('class="hint"')) html = '';
  const inj = (d.injuries || []).filter((t) => t.injuries?.length);
  if (inj.length) {
    html += section('Injuries', '', inj.map((t) => `<div class="card"><div class="board-head"><div class="ttl">${esc(t.team?.displayName || '')}</div></div>${
      t.injuries.slice(0, 10).map((i) => row(esc(i.athlete?.displayName || ''), esc([i.athlete?.position?.abbreviation, i.details?.type].filter(Boolean).join(' · ')), esc(i.status || ''))).join('')
    }</div>`).join(''));
  }
  return html + miniTable(d, comp) || hint('No extra info for this game yet.');
}

// ---------- main render ----------

function render() {
  $('#sports').innerHTML = SPORTS.map((s) => `<button class="chip${s.id === state.sport ? ' on' : ''}" data-sport="${s.id}">${s.label}</button>`).join('');
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));

  const loadingFirst = state.tab === 'news' ? !state.news
    : state.tab !== 'tables' && activeSports().some((id) => !state.data[id]);
  let html;
  if (loadingFirst) html = '<div class="empty">Loading…</div>';
  else if (state.tab === 'news') html = renderNews();
  else if (state.tab === 'live') html = renderLive();
  else if (state.tab === 'today') html = renderToday();
  else if (state.tab === 'upcoming') html = renderUpcoming();
  else html = renderTables();
  if (state.updated && !loadingFirst) html += `<div class="updated">Updated ${esc(time(state.updated))} · UK time</div>`;
  $('#view').innerHTML = html;
  renderSheet();
}

// ---------- events ----------

$('#sports').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-sport]');
  if (!b) return;
  state.sport = b.dataset.sport;
  store.set('sport', state.sport);
  render();
  refresh();
});

document.querySelector('.tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-tab]');
  if (!b) return;
  state.tab = b.dataset.tab;
  store.set('tab', state.tab);
  window.scrollTo(0, 0);
  render();
  refresh();
});

$('#view').addEventListener('click', (ev) => {
  const seg = ev.target.closest('.seg button');
  if (seg) {
    const role = seg.parentElement.dataset.role;
    if (role === 'tsport') { state.tableSport = seg.dataset.v; store.set('tableSport', state.tableSport); }
    if (role === 'sub') { state.sub[tableSportId()] = seg.dataset.v; store.set('sub', state.sub); }
    render();
    refresh();
    return;
  }
  const fav = ev.target.closest('[data-fav]');
  if (fav && fav.dataset.fav) { toggleFav(fav.dataset.fav); return; }
  const m = ev.target.closest('[data-match]');
  if (m) { state.pushedMatch = true; location.hash = `match/${m.dataset.match}`; } // hashchange opens it, so Back closes it
});

$('#sheet').addEventListener('click', (ev) => {
  if (ev.target.closest('[data-close]')) { closeMatch(); return; }
  const t = ev.target.closest('[data-mtab]');
  if (t) { state.match.tab = t.dataset.mtab; renderSheet(); $('#sheet').scrollTop = 0; }
});
window.addEventListener('hashchange', openFromHash);

$('#refresh').addEventListener('click', () => refresh(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

syncAlertTeams();
openFromHash();
render();
refresh();
