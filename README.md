# Flat Hunt

Your own private flat-search tracker, for renting or buying in Germany. You tell it your budget, what you need and where you have to get to every day. It ranks every flat you add by your priorities, works out commute times and affordability, checks the area (everyday places, flood zones, noise, crime, census rent) and keeps your conversations with landlords in one place. Your application documents stay encrypted and only leave through a link you create, which expires and watermarks every page.

Optionally, a Claude routine on your computer searches Immowelt, Kleinanzeigen and WG-Gesucht for you, logs landlord replies and, only if you allow it, sends message templates you approved.

Every person runs their own copy. There are no accounts: one site, one password, one owner.

## Get started (about 10 minutes)

You need a [GitHub](https://github.com) account and a [Railway](https://railway.com) account. Any other host that runs Node.js 18+ with a persistent disk works too.

1. **Fork** this repository on GitHub (button at the top right).
2. **Create three secrets** in a terminal and save them in your password manager:

   ```sh
   echo "SITE_PASSWORD=$(openssl rand -base64 18)"
   echo "SYNC_KEY=$(openssl rand -hex 24)"
   echo "VAULT_KEY=$(openssl rand -base64 32)"
   ```

   Keep `VAULT_KEY` safe: without it your stored documents cannot be decrypted, not even by you.
3. **Deploy on Railway:** New Project → Deploy from GitHub repo → pick your fork.
4. **Add a volume** to the service with mount path `/data`. Without it, your data is lost on every deploy.
5. **Set the variables** on the service (Variables tab):

   | Variable | Value |
   |---|---|
   | `DATA_DIR` | `/data` |
   | `SITE_PASSWORD` | from step 2 |
   | `SYNC_KEY` | from step 2 (only needed for the Claude routine) |
   | `VAULT_KEY` | from step 2 (only needed for the document vault) |
   | `TRUST_PROXY` | `1` |

6. **Get your address:** Settings → Networking → Generate Domain. Open it, sign in with any username and your `SITE_PASSWORD`, and the setup wizard walks you through your profile.

## Using it

1. **Settings:** rent or buy, budget, rooms and size, and up to five places you travel to (work, school …) with a maximum travel time each.
2. **About me** (needs `VAULT_KEY`): your household and work for landlords, plus documents such as payslips. Nothing is shared until you create a share link.
3. **Add a listing:** paste a flat you found (any portal, including ImmoScout24). Flat Hunt checks it against your criteria, works out commute times and costs, and looks up the area in the background.
4. **Track it:** shortlist, log what the landlord said, update the status. When a landlord asks for documents, tick the ones to share and send them the link.

## Let Claude search for you (optional)

The routine is a scheduled task in the [Claude desktop app](https://claude.ai/download). It uses **your own Chrome** through Claude in Chrome, where you are logged in to the portals and your email, so it searches and writes exactly as you would. You do not log in to Flat Hunt with Claude: the routine talks to your site with the `SYNC_KEY`, which can add listings and log replies but cannot change your settings, templates, approvals or documents.

1. On Immowelt, Kleinanzeigen and WG-Gesucht, run the searches you want, logged in, and copy the result-page URLs. Narrow each search to three result pages or fewer.
2. Install the Claude desktop app and the Claude in Chrome extension, and stay logged in to the portals and your email in Chrome.
3. In a clone of your fork, run:

   ```sh
   ./scripts/install-routine.sh
   ```

   It asks for your site address, your `SYNC_KEY` and the search URLs, checks that the site accepts the key and prepares the routine prompt.
4. In the Claude desktop app, create a scheduled task (for example every 3 hours during the day) and paste the prompt the script prepared.

At first the routine only finds flats and logs replies. It writes to landlords only after you tick "Contacting landlords" in Settings, choose a pace and approve each message template. The switch in the page header pauses sending at any time. ImmoScout24 is never automated, because its terms forbid it. Details, safeguards and what the routine never does: [routine/README.md](routine/README.md).

Check each portal's terms yourself and remove a portal's search if it objects to automated use.

## Features

**Tracker**

- **Profile:** rent, buy or both; flat requirements; up to five important places with a travel-time limit each (car, bike or public transport); an optional radius; red-flag toggles; weights for the score; monthly net income.
- **Listings:** add and edit by hand, delete. An address change recomputes coordinates and commute times.
- **Commute:** car minutes via OSRM, bike minutes via the FOSSGIS bike router, public transport via Transitous, planned for the next weekday at each place's time. "Recalculate" runs in the background.
- **Criteria check:** every listing is checked against the profile. Failing listings stay in the list, labelled with the reasons, and sort below the rest. Unknown commute times pass but are marked.
- **Red flags:** a built-in catalogue (deposit before a viewing, payment by gift card, ID copy before any contact, and similar). You can switch entries off and add your own patterns.
- **Scores:** a weighted score per listing. Listings get an estimated score from their data, shown with "≈"; the Claude routine adds full ratings.
- **Affordability:** rent divided by net income, or the loan payment for a purchase, compared with the share of income you set aside for housing.
- **Purchase costs:** land-transfer tax by German state, plus 2 % for notary and land registry, plus the agent fee you enter. The rates were checked in June 2026; check again before buying.
- **Costs panel:** monthly and one-off costs per listing, including an editable maintenance reserve for purchases.

**Application documents**

- **Applicant profile:** household, work, what you can provide on request and a few sentences about you, with a one-page applicant summary PDF in German, English or Portuguese.
- **Document vault:** PDF, JPEG and PNG files up to 10 MB, stored encrypted with your `VAULT_KEY`. Payslips older than three months are flagged.
- **Document requests:** log on a listing which documents the landlord asked for; the listing moves to "Documents requested".
- **Share links, only after you approve:** you tick the documents for one landlord and get a link, valid for 7 days by default (1 to 30). You can revoke it at any time. The link is rate-limited. Every page of every document carries the watermark "Only for the application for <address> · <date>". Every document opened is logged with its time, but no IP address.
- **Redaction helper:** cover tax ID, social-security number or bank details before you share. It works in your browser, and the covered parts are removed from the saved copy, not just hidden. Before a payslip is shared for the first time, the page reminds you to do this.

**Area facts**

- **Everyday places:** nearest transit stop with its lines, supermarket, pharmacy, doctor, kindergarten, school, park and playground, in walking minutes (OpenStreetMap; a straight-line estimate is marked as such).
- **Flood zones:** whether the address lies in a mapped flood area, nationwide. River and coastal floods only, no heavy rain (Starkregen). "No mapped flood area" is not "no risk".
- **Noise:** mapped noise band at the address, NRW and Berlin only.
- **Crime:** recorded cases per 100,000 residents in the Kreis, compared with Germany. An area average counted where crimes happen, not a score for the street.
- **Census rent:** average net cold rent of the 1 km square in 2022 (existing tenancies, not a Mietspiegel and not market rent).
- **Price check:** price per m² against your tracked listings in the same postcode or city.
- **Area rating:** an estimate for the `area` score. 10 × the mean walking points over six groups (transit, supermarket, pharmacy, doctor, kindergarten or school, park or playground; up to 5 min 1, 10 min 0.75, 15 min 0.5, 20 min 0.25), minus flood (3 for frequent, 2 for HQ100, 0.5 for extreme or unclassified), noise (2 from 70 dB, 1.5 from 65, 1 from 60, 0.5 from 55) and crime (1 from 1.5 × the national rate, 0.5 from 1.2 ×), rounded to 0–10. Figures with no data or an error deduct nothing. The tooltip shows the numbers.

The facts are computed in the background on your server after a listing is added or moved, and on "Recompute". Each figure shows its source, area level, data year and retrieval date; the page footer credits all sources.

The facts are computed in the background on your server after a listing is added or moved, and on "Recompute". Each figure shows its source, area level, data year and retrieval date; the page footer credits all sources.

**Claude routine and automatic answers**

- **Routine:** searches Immowelt, Kleinanzeigen and WG-Gesucht in your own logged-in browser and adds fitting listings. ImmoScout24 is manual only.
- **Message templates** in German and English with placeholders, a preview and approval per version; editing a template withdraws its approval. The language also sets the default language of share pages and the applicant summary PDF (`?lang=pt` still works for the summary).
- **Pace:** a minimum gap between messages and a daily cap (Berlin calendar day).
- **Pause switch** in the header with today's count. It stops new sends at once; a message already being sent can still go out.
- **Replies** are logged with their intent. A viewing invitation becomes a proposal you confirm or decline, also on a rejected listing; a rejection cancels confirmed viewings too.
- **Documents requests** are recorded; documents still leave only through a share you create.
- **Never:** documents, share links, unapproved texts, a second message for the same slot, texts in its own words, ImmoScout24.

### What a landlord sees

A share link opens a page that lists the documents you shared, and each document opens as a PDF with the watermark on every page. Nothing else of your hunt is reachable through it. The link stops working when it expires or you revoke it; after that it answers "Not found", like any unknown link. Each open is logged with its time and the document, never with an IP address, and you see the opens on the listing.

The token is part of the link's path, so your host's access logs may record it. Revoke links you no longer need.

## Reference

### All variables

- `DATA_DIR` — where the JSON data files are kept. Point it at a persistent volume.
- `SITE_PASSWORD` — the password for the whole site. The server refuses to start without it (unless `ALLOW_OPEN=1` for local testing).
- `SYNC_KEY` — the routine's key. With it, only the routine's own routes are reachable (listings, photos, sync, send slots and replies); it can read your profile but cannot change settings, templates, approvals or documents. Without it those routes return 503.
- `VAULT_KEY` — 32 random bytes in base64, for the applicant profile and document vault. Once the vault has been opened with a key, the server only starts with that same key. To start over with a new key, stop the server and delete the empty `DATA_DIR/vault` folder. Without `VAULT_KEY` the profile, documents and share links are off. The server refuses `VAULT_KEY` without `SITE_PASSWORD`.
- `TRUST_PROXY=1` — set it behind one proxy (Railway), so the share-link rate limit counts visitors instead of the proxy.
- `OVERPASS_URL` (optional) — your own Overpass instance instead of the public servers, which are often overloaded.

`/healthz` and share links (`/s/<token>`) are the only routes that do not require the password.

### Run it locally

```sh
npm install
ALLOW_OPEN=1 DATA_DIR=./data SYNC_KEY=dev npm start
```

Then open http://localhost:3000. With `ALLOW_OPEN=1` there is no password and the document vault stays off. To try the vault, set a password and a key instead:

```sh
SITE_PASSWORD=test DATA_DIR=./data SYNC_KEY=dev VAULT_KEY=$(openssl rand -base64 32) npm start
```

A new key on each start cannot open the vault of the previous run: keep one key per data directory.

Set `SEED=1` on the first start, with no `listings.json` yet, to load example listings from a `seed.json` next to `server.js`. No seed file ships with the repository.

Tests: `npm test`. The design is in [docs/design.md](docs/design.md). Flat Hunt builds on [Car Hunt](https://github.com/DasMehl/car-hunt).

### Area data and coverage

| Source | Licence | Attribution |
|---|---|---|
| OpenStreetMap via Overpass API | ODbL 1.0 | © OpenStreetMap contributors |
| FOSSGIS foot routing | ODbL 1.0 | Routing: FOSSGIS e. V., data © OpenStreetMap contributors |
| BfG INSPIRE Natural Risk Zones (flood hazard maps, 2nd cycle 2019) | GeoNutzV | WasserBLIcK/BfG; Zuständige Behörden der Länder |
| Umgebungslärmkartierung NRW 2022 (LANUK) | dl-de/by-2-0 | Land NRW (2022) |
| Strategische Lärmkarten Berlin 2022 | dl-de/zero-2-0 | Umweltatlas Berlin |
| Polizeiliche Kriminalstatistik 2025, table T01 | dl-de/by-2-0 | Bundeskriminalamt |
| Verwaltungsgebiete 1:250 000 (VG250) | dl-de/by-2-0 | © BKG |
| Zensus 2022, net cold rent, 1 km grid | dl-de/by-2-0 | © Statistische Ämter des Bundes und der Länder |

The texts shown on the page live in `public/area-sources.js`.

**Coverage limits**

- Noise: only NRW and Berlin. Elsewhere the panel says "no data". A point with no mapped source is not necessarily quiet: only major roads, airports, industry and (NRW) railways and trams are mapped. Berlin's map has no federal railways (S-Bahn, DB; the Eisenbahn-Bundesamt maps those); the panel says so and links to the EBA noise map.
- Flood: the BfG does not guarantee completeness. River and coastal floods only, no heavy rain.
- Crime: per Kreis or district-free city, counted where crimes happen. The Kreisart in the data: `KfS` district-free city, `SK` Stadtkreis (Baden-Württemberg), `LK` Landkreis, `K` Kreis (Schleswig-Holstein, NRW), `RV` Regionalverband (Saarbrücken).
- Census rent: existing tenancies on 15.05.2022. Cells with too few rented flats are empty.
- OpenStreetMap completeness varies, doctors and kindergartens especially in rural areas.

**Update rhythm and regeneration.** The PKS appears yearly in spring, the Zensus every ten years, noise maps every five years and flood maps every six. The two static files (`lib/data/pks-2025-kreise.json`, about 21 KB, and `lib/data/zensus2022-rent-1km.u16.gz`, about 278 KB) are rebuilt from the official downloads:

```sh
node scripts/area-data.js pks      # https://www.bka.de/ (PKS table KR-F-01-T01-Kreise-Faelle-HZ)
node scripts/area-data.js zensus   # https://www.destatis.de/static/DE/zensus/gitterdaten/Zensus2022_Durchschn_Nettokaltmiete.zip
```

**Live check.** `node scripts/area-smoke.js <lat> <lon>` asks every source once for a point and prints one line per figure. It uses the network and is not part of `npm test`.

**Self-hosted OpenStreetMap fallback.** If the public Overpass servers stay unusable, run your own: download the state file from Geofabrik (`nordrhein-westfalen-latest.osm.pbf`, 915 MB; `germany-latest.osm.pbf`, 4.9 GB), filter it with `osmium tags-filter` to the eight place types and platforms, serve it through an own Overpass instance and set `OVERPASS_URL`. A SQLite/R-tree lookup instead of Overpass is possible later.

### Data and services

Flat Hunt uses free public services and does not run its own scrapers:

- [OpenStreetMap](https://www.openstreetmap.org/copyright) map data, and [Nominatim](https://nominatim.org/) for geocoding addresses.
- [OSRM](https://project-osrm.org/) for driving times.
- [FOSSGIS](https://routing.openstreetmap.de/) bike routing for cycling times.
- [Transitous](https://transitous.org/) for public-transport times.
- [Overpass API](https://overpass-api.de/) (OpenStreetMap, ODbL) for everyday places, and [FOSSGIS foot routing](https://routing.openstreetmap.de/) for walking minutes.
- [BfG](https://geoportal.bafg.de/) flood hazard maps (GeoNutzV).
- Noise maps of [LANUK NRW](https://www.lanuv.nrw.de/) (dl-de/by-2-0) and the [Umweltatlas Berlin](https://www.berlin.de/umweltatlas/) (dl-de/zero-2-0).
- [BKA](https://www.bka.de/) Polizeiliche Kriminalstatistik (dl-de/by-2-0) and the [BKG](https://gdz.bkg.bund.de/) VG250 administrative areas (dl-de/by-2-0).
- [Zensus 2022](https://www.zensus2022.de/) grid data of the statistical offices (dl-de/by-2-0).
- [pdf.js](https://mozilla.github.io/pdf.js/) (loaded from cdnjs) for the redaction helper, and [pdf-lib](https://pdf-lib.js.org/) for watermarks and the applicant summary.

The lookups run on your server when you add or edit a listing, and from the routine. Each service has a usage policy; keep your use within it.
