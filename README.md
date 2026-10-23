# Scoreboard

A personal Flashscore-style web app for English football, NFL, golf, F1, UFC and boxing.

- **Live**: in-play scores, refreshed every 30 seconds while anything is live
- **Today**: today's matches, sessions, leaderboards and fight cards
- **Upcoming**: the next two weeks, grouped by day (plus golf and UFC calendars)
- **Tables**: Premier League to League Two, NFL conferences, F1 drivers and constructors, golf leaderboard, UFC rankings
- **News**: notes (position, record, last result, next game) and news for Oldham Athletic, Man Utd and the Steelers; Irish golfers in this week's fields plus their news; then headlines for each sport. Followed teams are set in `FOLLOW` at the top of `app.js`.

Tap a team or driver in a table to make it a favourite. Its matches are then pinned to the top of Today and Upcoming. Times are UK time.

## Data sources (free, no keys)

| Sport | Source |
|---|---|
| Football, NFL, golf, UFC, live F1 | ESPN's public JSON endpoints (unofficial) |
| F1 schedule & standings | [Jolpica](https://github.com/jolpica/jolpica-f1) |
| Boxing | [TheSportsDB](https://www.thesportsdb.com) (free test key) |
| UFC rankings | ufc.com/rankings, scraped by GitHub Actions |
| Oldham club news | oldhamathletic.co.uk news API (read live in the browser) |
| News | ESPN news endpoints, plus BBC Sport RSS (Oldham, Man Utd, golf, boxing) and the Oldham fans' forum (shown as opinion) fetched by GitHub Actions every 3 hours |

The data is for personal use only.

## Hosting

The `Deploy` workflow publishes the site to GitHub Pages on every push and every 3 hours. To turn it on, go to **Settings → Pages → Source** and choose **GitHub Actions**.
On your phone, open the Pages URL and use **Add to Home Screen**. It then opens full screen like an app.

## Running locally

```
npm run news            # optional: refresh data/news.json
python -m http.server 8123
```
Then open http://localhost:8123 (port 8000 is often taken on Windows, e.g. by the Epic Games launcher).
