// Fetches BBC Sport RSS feeds into JSON for the News tab (BBC doesn't allow browser fetches).
// Never fails the build: a feed that errors keeps its previous items.
// `node scripts/news.mjs --selftest` checks the RSS parser.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import assert from 'node:assert';

const BBC = 'https://feeds.bbci.co.uk/sport';
const FEEDS = {
  oldham: `${BBC}/football/teams/oldham-athletic/rss.xml`,
  manutd: `${BBC}/football/teams/manchester-united/rss.xml`,
  golf: `${BBC}/golf/rss.xml`,
  boxing: `${BBC}/boxing/rss.xml`,
  forum: 'https://members.boardhost.com/oafc/rss', // Oldham fans' message board: opinion, not news
};

// The forum feed has no dates, but each thread's ID is its Unix timestamp (msg/1792775903.html).
// Off-topic threads ("O/T", "non footy") are dropped.
function forumThreads(items) {
  return items
    .filter((a) => !/\bO ?\/? ?T\b|non[- ]?footy/i.test(a.title))
    .map((a) => {
      const id = a.url.match(/msg\/(\d+)\.html/)?.[1];
      return {
        ...a,
        url: a.url.replace(/^http:/, 'https:'),
        date: id ? new Date(id * 1000).toISOString() : null,
        desc: a.desc.replace(/^Posted by (.+?) on [^;]*;\s*(\d+ responses?).*$/, '$1 · $2'),
        source: 'Fan forum',
      };
    });
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const tag = (xml, t) => {
  const m = xml.match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`));
  return m ? decode(m[1].trim()) : '';
};

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map(([, it]) => {
      const d = new Date(tag(it, 'pubDate'));
      return { title: tag(it, 'title'), url: tag(it, 'link').split('?')[0], date: isNaN(d) ? null : d.toISOString(), desc: tag(it, 'description'), source: 'BBC' };
    })
    .filter((a) => a.title && /^https?:/.test(a.url));
}

const out = process.argv[2] || 'data/news.json';

if (out === '--selftest') {
  const xml = `<rss><channel><title>BBC</title><item><title><![CDATA[Lowry & McIlroy win]]></title>
    <description><![CDATA[Pairs event.]]></description><link>https://www.bbc.co.uk/sport/golf/x?at_medium=RSS&amp;a=b</link>
    <pubDate>Fri, 23 Oct 2026 14:41:19 GMT</pubDate></item><item><title>No link</title></item></channel></rss>`;
  assert.deepStrictEqual(parseRss(xml), [{ title: 'Lowry & McIlroy win', url: 'https://www.bbc.co.uk/sport/golf/x', date: '2026-10-23T14:41:19.000Z', desc: 'Pairs event.', source: 'BBC' }]);
  const forum = `<item><title>Sitting on their hands?</title><link>http://members.boardhost.com/oafc/msg/1792773809.html</link>
    <description>Posted by Hardwick on 23/10/2026, 5:43 pm; 1 response, posted 23/10/2026, 6:07 pm</description></item>
    <item><title>O T FAO  Spanish Blue</title><link>http://members.boardhost.com/oafc/msg/1792698252.html</link><description>x</description></item>`;
  assert.deepStrictEqual(forumThreads(parseRss(forum)), [{ title: 'Sitting on their hands?', url: 'https://members.boardhost.com/oafc/msg/1792773809.html', date: '2026-10-23T16:43:29.000Z', desc: 'Hardwick · 1 response', source: 'Fan forum' }]);
  console.log('news selftest ok');
  process.exit(0);
}

mkdirSync(dirname(out), { recursive: true });
let prev = {};
try { prev = JSON.parse(readFileSync(out, 'utf8')).feeds || {}; } catch {}

const feeds = {};
for (const [k, url] of Object.entries(FEEDS)) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    feeds[k] = parseRss(await r.text());
    if (k === 'forum') feeds[k] = forumThreads(feeds[k]);
    feeds[k] = feeds[k].slice(0, 25);
    if (!feeds[k].length) throw new Error('no items (feed format changed?)');
  } catch (e) {
    console.warn(`BBC ${k} failed: ${e.message}`);
    feeds[k] = prev[k] || [];
  }
}
writeFileSync(out, JSON.stringify({ updated: new Date().toISOString(), feeds }));
console.log(`News: ${Object.entries(feeds).map(([k, v]) => `${k}=${v.length}`).join(' ')}`);
