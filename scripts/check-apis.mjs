// Prints whether each data source responds and allows browser (CORS) access.
const d = new Date();
const ymd = (x) => x.toISOString().slice(0, 10).replace(/-/g, '');
const E = 'https://site.api.espn.com/apis/site/v2/sports';
const urls = [
  `${E}/soccer/eng.1/scoreboard?dates=${ymd(d).slice(0, 6)}`,
  `${E}/soccer/eng.2/scoreboard?dates=${ymd(d).slice(0, 6)}`,
  `${E}/soccer/eng.league_cup/scoreboard?dates=${ymd(d).slice(0, 6)}`,
  `${E}/football/nfl/scoreboard?dates=${ymd(d).slice(0, 6)}`,
  `${E}/golf/pga/scoreboard`,
  `${E}/golf/eur/scoreboard`,
  `${E}/racing/f1/scoreboard`,
  `${E}/mma/ufc/scoreboard`,
  `${E}/mma/ufc/scoreboard?dates=${ymd(d)}-${ymd(new Date(+d + 60 * 864e5))}`,
  'https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings',
  'https://site.api.espn.com/apis/v2/sports/football/nfl/standings',
  'https://api.jolpi.ca/ergast/f1/current.json',
  'https://api.jolpi.ca/ergast/f1/current/driverStandings.json',
  'https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=4445',
];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: { origin: 'https://example.github.io' } });
    const txt = await r.text();
    let summary = '';
    try {
      const j = JSON.parse(txt);
      summary = `keys=${Object.keys(j).slice(0, 6).join(',')}`;
      if (j.events) summary += ` events=${j.events.length}`;
      if (j.children) summary += ` groups=${j.children.length}`;
      if (j.events && j.events[0]?.strLeague) summary += ` league=${j.events[0].strLeague}`;
    } catch { summary = 'not JSON'; }
    console.log(`${r.status} cors=${r.headers.get('access-control-allow-origin')} ${u}\n    ${summary}`);
  } catch (e) {
    console.log(`ERR ${u} ${e.message}`);
  }
}
