// Scrapes ufc.com/rankings into JSON for the app. Never fails the build:
// on error it keeps the previous file (or writes an empty one).
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as cheerio from 'cheerio';

const out = process.argv[2] || 'data/ufc-rankings.json';
mkdirSync(dirname(out), { recursive: true });

try {
  const res = await fetch('https://www.ufc.com/rankings', { headers: { 'user-agent': 'Mozilla/5.0 (personal scoreboard)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  const divisions = [];
  $('.view-grouping').each((_, g) => {
    const name = $(g).find('.view-grouping-header').first().text().trim();
    if (!name) return;
    const champion = $(g).find('.rankings--athlete--champion h5 a, .rankings--athlete--champion h5').first().text().trim();
    const fighters = [];
    $(g).find('tbody tr').each((__, tr) => {
      const rank = $(tr).find('.views-field-weight-class-rank').text().trim();
      const fname = $(tr).find('.views-field-title a').first().text().trim() || $(tr).find('.views-field-title').text().trim();
      if (fname) fighters.push({ rank: rank || String(fighters.length + 1), name: fname });
    });
    divisions.push({ name, champion, fighters });
  });
  if (!divisions.length) throw new Error('No divisions found (page layout changed?)');
  writeFileSync(out, JSON.stringify({ updated: new Date().toISOString(), divisions }, null, 1));
  console.log(`UFC rankings: ${divisions.length} divisions`);
} catch (e) {
  console.warn(`UFC rankings failed: ${e.message}`);
  let prev = '{"updated":null,"divisions":[]}';
  try { prev = readFileSync(out, 'utf8'); } catch {}
  writeFileSync(out, prev);
}
