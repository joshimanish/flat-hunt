# Flat Hunt: design

Date: 19.10.2026. Status: approved in chat.

## Goal

A self-hosted tracker for finding a flat to rent or buy in Germany. Each person runs their own copy. They describe themselves (household, job, income), what they want (rent and/or buy, size, rooms, move-in date) and where (commute limits to important places plus an optional radius). The site ranks listings by their own weights, analyses each listing's surroundings with sourced facts, keeps landlord conversations, stores application documents encrypted and shares them only after the owner approves. An optional Claude Code routine finds listings and sends approved template answers.

Flat Hunt starts as a copy of Car Hunt (https://github.com/DasMehl/car-hunt) with fresh history: same server pattern, storage, password, wizard and Settings framework, add/edit/delete, map, weighted scores, en/de/pt, routine structure.

Out of scope: accounts or several hunts in one copy; server-side scraping of portals; automated access to ImmoScout24 (its terms forbid it — its links can still be added by hand); a per-street "danger score"; sending documents without the owner's approval.

## Decisions made in chat

- Renting and buying, selectable per copy (one or both).
- Documents leave only after the owner approves, through an expiring, watermarked link.
- Search area = up to five important places with a maximum travel time (car, public transport or bike) plus an optional radius; a listing must satisfy all limits.
- Public repository; no personal data in code.
- Built in four phases, each usable on its own.

## Phases

1. **Core tracker** — profile (rent/buy, flat, places, radius, red flags, weights, income), listings with add/edit/delete, criteria check, scores, commute times, affordability, costs panel, map. Usable by hand.
2. **Applicant profile and document vault** — applicant details and summary, encrypted documents, approval-gated share links with watermark and access log, redaction helper.
3. **Area analysis** — sourced facts per listing. Starts with a spike that confirms each data source's availability and licence; a source that fails is dropped, never faked.
4. **Routine and automatic answers** — Claude Code routine for Immowelt, Kleinanzeigen and WG-Gesucht; approved templates; reply handling; pause switch.

Each phase gets its own implementation plan.

## Profile (`DATA_DIR/profile.json`, phase 1)

```json
{
  "version": 1,
  "name": "Flat Hunt",
  "languages": ["en", "de", "pt"],
  "modes": { "rent": true, "buy": false },
  "money": { "netIncome": 3200, "affordShare": 0.33 },
  "rent": { "maxWarm": 1200, "maxCold": null, "maxDeposit": null, "maxTakeover": null },
  "buy": { "maxPrice": 350000, "equity": 70000, "apr": 3.8, "years": 25, "state": "NW", "agentFeePct": 3.57 },
  "flat": {
    "roomsMin": 2, "roomsMax": null, "sizeMin": 55, "sizeMax": null,
    "floorMin": null, "floorMax": null, "needsLift": false,
    "outdoor": "any", "kitchen": "any", "pets": false,
    "moveInFrom": null, "moveInTo": null, "wbs": "none"
  },
  "places": [ { "label": "Work", "address": "Königsallee 1, 40212 Düsseldorf", "lat": 51.2254, "lon": 6.7787, "mode": "transit", "maxMin": 40, "time": "08:00" } ],
  "radius": { "center": null, "km": null },
  "redFlags": [ { "id": "deposit-before-viewing", "on": true } ],
  "weights": { "price": 2, "size": 1.5, "commute": 2, "area": 1, "condition": 1, "contact": 1 },
  "outreach": { "enabled": false, "paused": false, "language": "de", "minGapMin": 20, "dailyCap": 10 }
}
```

- `modes`: at least one true. Rent-only fields are ignored when `rent` is false, likewise for `buy`.
- `money.netIncome`: household net per month; `affordShare` (0.2–0.5, default 0.33) is the share of income housing may take.
- `buy.state`: two-letter German state code; it selects the land-transfer-tax rate.
- `flat.outdoor`: any | balcony | garden; `kitchen`: any | required; `wbs`: none (no housing permit) | have (permit held, WBS flats allowed) | exclude (hide WBS-only flats).
- `places`: 0–5 entries; `mode`: car | transit | bike; `maxMin` 5–180; `time` HH:MM used for transit planning on a weekday.
- `radius`: optional; both `center` and `km` set, or both null.
- `outreach`: `language` de | en (templates exist in both; it is also the default language of share pages and the applicant summary PDF, which still accepts `?lang=pt`); `minGapMin` 5–1440 minutes between two messages; `dailyCap` 1–50 messages per Berlin calendar day. Saving the profile leaves `paused` unchanged; it belongs to the header switch.
- Validation is strict like Car Hunt's (unknown keys rejected, ranges, enums, cross-field rules).

## Listing record (`DATA_DIR/listings.json`)

Listing fields: `title`, `url`, `source` (immowelt | kleinanzeigen | wg-gesucht | immoscout | other | manual), `mode` (rent | buy), `coldRent`, `utilities`, `warmRent`, `deposit`, `takeover`, `price`, `rooms`, `size`, `floor`, `lift`, `outdoor`, `kitchen`, `petsAllowed`, `availableFrom`, `wbsRequired`, `address`, `postcode`, `city`, `district`, `lat`, `lon`, `commute` (array aligned with `profile.places`: `{minutes, checkedAt}` or null), `area` (phase 3 cache), `contact` (`{name, type: private | agent | company}`), `photos`, `rating` (`price, size, commute, area, condition, contact`, 0–10), `redFlags` (ids found), `verdict`, `pros`, `cons`, `questions`, `i18n`, `addedAt`, `lastSeenAt`, `priceHistory`, `gone`, `goneAt`. The routine sets `url` and `source` only when it creates a listing; later upserts leave them alone.

Owner fields (edited on the page): `status` (new | contacted | viewing-invited | viewing-done | applied | docs-requested | accepted | rejected | dropped | gone), `nextStep`, `notes`, `pick` (the routine may set it when it creates a listing), `messages`, `docRequests` (phase 2).

- `messages[]`: `{date, dir: in | out, from, via, text, i18n?}`. Messages from the routine carry more: a sent template `lang`, `templateId`, `templateVersion` and `claimId`; a logged reply `intent` and, when the portal or mail has one, `externalId`. The owner adds a message with `POST /api/listings/:id/messages` (appended); a `messages` list sent with `PATCH` replaces only the owner's own messages, every message with `claimId`, `externalId` or `intent` stays.
- `viewings[]` (written only by the server): `{id, createdAt, proposedTimes, status: pending | confirmed | declined | cancelled, time, decidedAt, confirmationSentAt}`.

- `warmRent` is computed as `coldRent + utilities` when not given.
- Manual add and edit work as in Car Hunt; a changed address recomputes coordinates and commute times; deleting removes photos and log entries.

## Criteria, scores and affordability (phase 1)

- Criteria check (shared browser/Node module like Car Hunt's `criteria.js`): mode enabled, warm/cold rent or price limits, deposit and takeover limits, rooms, size, floor, lift, outdoor, kitchen, pets, move-in window, WBS rule, every place's commute limit (unknown commute passes but is marked), radius, red flags. Failing listings are labelled with reasons and sorted below, never deleted.
- Score = round(Σ rating × weight ÷ Σ weights × 10). Listings without `rating` get an estimate from data (price vs limit, size vs minimum, commute vs limits, equipment) shown with "≈", as in Car Hunt.
- Affordability:
  - Rent: `warmRent ÷ netIncome` → fits (≤ affordShare), tight (≤ affordShare + 0.05), too much.
  - Buy: monthly annuity on `price + purchase costs − equity` at `apr` over `years`, compared the same way. Purchase costs = land-transfer tax for `state` + 2 % notary and land registry + `agentFeePct`. The state rates live in one table in the code with the date they were checked; the page says "rates as of <date>, check before buying".
- Costs panel: per listing, monthly (warm rent or loan payment + an editable maintenance reserve for buying) and one-off (deposit and takeover, or purchase costs + equity used).

## Commute (phase 1)

- Car: OSRM driving (`router.project-osrm.org`). Bike: the FOSSGIS bike router (`routing.openstreetmap.de/routed-bike`). Public transport: Transitous, next weekday at the place's `time`, arriving by then.
- Computed on the server when a listing is added or its address changes, and by the routine; each value stores `checkedAt`. A failed lookup leaves the value null.

## Red flags (phase 1)

Built-in catalogue (`public/redflags.json`, en/de/pt label and reason, a text pattern for the routine and the manual add's notes): deposit or fees before a viewing; owner abroad / keys by post; price far below tracked listings in the same city (computed, not text); payment by gift card, crypto or money-transfer service; request for ID copy before any contact; "Besichtigung nur gegen Gebühr". Users toggle entries and add their own patterns.

## Applicant profile and vault (phase 2)

- `applicant.json`: name, email, phone, household (adults, children, pets), job (title, employer, since, permanent), credit report available, current landlord reference available, short "about us". Stored encrypted.
- Applicant summary: generated one page (HTML → PDF on demand) in de/en/pt from `applicant.json` and `money.netIncome`.
- Vault: uploads (PDF, JPEG, PNG; ≤ 10 MB each) stored in `DATA_DIR/vault/` encrypted with AES-256-GCM using `VAULT_KEY` (32 bytes, base64, environment variable, never on the volume). Metadata (type: payslip | contract | schufa | id | rent-confirmation | landlord-reference | other, label, document date, size) is encrypted too. The server refuses to start with vault data but no or a wrong `VAULT_KEY`. Payslips older than three months are flagged.
- Sharing: a document request on a listing shows a checklist; on approval the server creates a share: random 32-byte token (only its SHA-256 stored), listing id, document ids, expiry (default 7 days, 1–30), revocable. `GET /s/<token>` is public (the only public route besides `/healthz`), rate-limited, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, and serves each document as a PDF with a watermark on every page: "Only for the application for <listing address>, <date>". Each opening is logged with time (no IP).
- Redaction helper: in the browser, render a page (pdf.js from cdnjs for PDFs), draw black boxes, save as a flattened image PDF so the covered text is gone. Before the first share of a payslip the site reminds the owner to cover tax ID, social-security number and bank details.

## Area analysis (phase 3)

Sources confirmed by the data spike of 19.10.2026 and re-checked live by `scripts/area-smoke.js`. A source that fails is dropped, never faked. Each figure in the listing's "Area" panel shows its source, area level, data year and retrieval date; a page footer credits every source. Every source has a dataset link (`url`) and a licence link (`licenceUrl`) in `public/area-sources.js`.

| Figure | Source | Area level | Coverage |
|---|---|---|---|
| Everyday places: nearest transit stop (bus stop, tram stop, station) with its lines, supermarket, pharmacy, doctor, kindergarten, school, park, playground; walking minutes | OpenStreetMap via Overpass (ODbL); walking minutes from the FOSSGIS foot router, straight-line estimate (marked) when routing fails | 1 km around the address (stops 500 m) | Germany; OSM completeness varies |
| Flood: HQhäufig (`high`), HQ100 (`medium`), HQextrem (`low`), `unknown` for a mapped area without class | BfG INSPIRE "Natural Risk Zones" (HWRM-RL maps, 2nd cycle 2019; GeoNutzV) | the address | Germany, completeness not guaranteed; river and coastal only, no heavy rain |
| Noise: Lden band (5 dB) per source (road, rail, tram, air, industry) and the loudest | LANUK NRW `laerm_stufe4` (dl-de/by-2-0), Umweltatlas Berlin `ua_stratlaerm_2022` (dl-de/zero-2-0), round 4 (2022) | the address | NRW and Berlin only |
| Crime: cases per 100,000 residents vs the national rate (all offences, violent, street, residential burglary) | BKA PKS 2025 table T01 Kreise (dl-de/by-2-0), shipped as `lib/data/pks-2025-kreise.json` (~21 KB); Kreis from the BKG VG250 WFS (dl-de/by-2-0) | the whole Kreis or district-free city | Germany |
| Census rent: average net cold rent of existing tenancies | Zensus 2022 1 km grid (dl-de/by-2-0), shipped as `lib/data/zensus2022-rent-1km.u16.gz` (~278 KB) | 1 km grid square | Germany, cells with too few rented flats suppressed |
| Price check: price per m² vs tracked listings | the hunt's own listings | same postcode, else same city | — |

### Implementation

- `lib/area-http.js`: shared request helper. Flat Hunt User-Agent, timeout, response capped (5 MB by default; 8 MB for Overpass, 1 MB for the foot router), redirects not followed, retry with back-off on 429/502/503/504, timeouts and network errors, and a spacer that serialises calls with a minimum gap.
- `lib/coords.js` rejects points outside Germany's bounding box before any request. `lib/kreis.js` asks the BKG VG250 WFS for the Kreis (AGS) of the point.
- `lib/crime.js`: looks the AGS up in the PKS table; `kind` is the Kreisart as published (`RV` Regionalverband, `LK` Landkreis, `KfS` kreisfreie Stadt, `K` Kreis (Schleswig-Holstein, NRW), `SK` Stadtkreis (Baden-Württemberg)). The national rate is the sum of all Kreise's cases over their residents.
- `lib/flood.js`: zones `high | medium | low | unknown`; an empty answer is `no-data`.
- `lib/noise.js`: adapters for NRW (Esri WMS, `text/xml`) and Berlin (GeoServer, JSON), one layer per source, one at a time. An answer that is not recognised is an error, never "quiet". Berlin's lowest class "bis 55 dB(A)" is a readable answer below the threshold. Berlin has no federal railways (S-Bahn, DB: the Eisenbahn-Bundesamt maps them), so its adapter lists `uncovered: ["rail"]`, carried into the figure; the panel then says so, links to the EBA noise map and does not claim railways are mapped. Other states give `no-data`.
- `lib/rent-grid.js`: dense 1 km grid in EPSG:3035, euro cents per m²; 0 means no value. The figure is existing tenancies on 15.05.2022, not market rent.
- `lib/amenities.js`: Overpass, one query at a time and at least 10 s apart; retries after 30, 60 and 120 s on overload; `OVERPASS_URL` replaces the public endpoint. Results cached 30 days per ~100 m (`lib/area-cache.js`), the nearest 10 per category; distances are re-measured from the listing's exact point. The nearest three per category are routed on foot.
- `lib/area.js` assembles the figures; `lib/area-job.js` is the background queue (one listing at a time, 1.5 s apart so the free map services are not hit back to back) and `lib/area-api.js` the routes, including recompute. Computed after a listing is added, after its address or the routine's coordinates change, at start-up for listings without facts, and on "Recompute". Never inside a request. Only the server writes `area`.

### Data model and wording

- Cached on the listing as `area`: `lat`, `lon`, `computedAt`, and per figure `status` ok | no-data | error, `source`, `level`, `fetchedAt`.
- "No data" is never shown as "no risk": an empty flood answer means no mapped flood area was found and coverage is not guaranteed; no mapped noise source means none above the mapping threshold, not quiet. Cached amenities show the cache entry's time as retrieval date.
- Crime is always labelled as an area average counted where crimes happen, never coloured as good or bad, never on the card and never a per-street score. Berlin's district-level atlas (CC BY-SA) is not used in phase 3.
- The `area` rating key gets an estimate: 10 × the mean walking points over six groups (transit, supermarket, pharmacy, doctor, kindergarten or school, park or playground; ≤ 5 min 1, ≤ 10 0.75, ≤ 15 0.5, ≤ 20 0.25), minus flood (HQhäufig 3, HQ100 2, HQextrem 0.5, unknown class 0.5), noise (≥ 70 dB 2, ≥ 65 1.5, ≥ 60 1, ≥ 55 0.5) and crime (≥ 1.5 × national 1, ≥ 1.2 × 0.5), rounded and clamped to 0–10; the tooltip shows the formula and the listing's numbers. Figures with no data or an error deduct nothing.
- The static files are produced by `scripts/area-data.js` from the official downloads and carry source, licence, attribution and generation date.
- Live check: `node scripts/area-smoke.js <lat> <lon>` runs every source once against the real services (not part of `npm test`). On its first run it showed that Berlin answers "bis 55 dB(A)" for the lowest class; the parser reads it now.
- Fallback for Overpass: a self-hosted OSM extract (Geofabrik + osmium) behind `OVERPASS_URL`.

## Routine and automatic answers (phase 4)

- **Routine:** `routine/SKILL.md`, a Claude Code scheduled task in the owner's own logged-in browser. It runs the owner's saved searches on Immowelt, Kleinanzeigen and WG-Gesucht (ImmoScout24 stays manual: its terms forbid automated access), applies the profile and red flags, adds listings with photos (`PUT /api/img`), commute times and a rating, syncs warm and cold rent or price, and logs landlord replies. It authenticates with the sync key only; it never has the site password. Each saved search must stay at 3 result pages or fewer, otherwise gone listings are never detected.
- **Two roles:** a request with `x-sync-key` reaches only the routine's routes (profile, listings, meta, red flags, outreach status, listing upsert, photos, sync, send slots, replies). Templates, approvals, the pause switch, viewing decisions, statuses, the vault and share links are owner-only, also when the password is sent along.
- **Templates:** first contact, viewing confirmation, documents follow and "not interested anymore", in de and en, in `DATA_DIR/outreach.json`. Placeholders `{greeting}`, `{name}`, `{household}`, `{job}`, `{income}`, `{moveIn}`, `{listingTitle}`, `{address}` and, for the confirmation, `{viewingTime}`; unknown placeholders are rejected on save; Settings shows a preview with the real applicant profile. Each text has a `version`; approval stores `approvedAt` for that version and any edit withdraws it. The server fills the text when the routine claims a slot; the routine never receives the applicant profile.
- **Send slots:** before every message the routine claims a slot. The server grants it only when outreach is enabled and not paused, the template is approved, the listing is eligible (first contact: shortlisted, status new, no outgoing message yet, all criteria met, no red flag; viewing confirmation: a viewing the owner confirmed; documents follow: documents requested; decline: dropped after contact and no rejection from the landlord), fewer than `dailyCap` slots were used today, the last one is at least `minGapMin` minutes old and every placeholder has a value. Checks and reservation happen without interruption; one slot per listing and template (per viewing for confirmations), at most 3 claims per listing and template per Berlin day. A retry of the same claim returns the same slot only while the claim is valid: a repeat re-checks approval, version and eligibility, and a claim whose save is still running answers "busy". After sending, the routine reports `sent` (the message is logged once with its template and version) or `release` (nothing went out). A claim unanswered for 24 h expires and blocks that template for that listing for good, because a send may have happened; the update log shows "Expired, maybe sent: check". When its message already reached the listing, the claim is closed as sent instead. "already-contacted" closes the slot for good too. ImmoScout24 is refused by `source` and by URL host.
- **Duplicate check:** per template, before every claim, across the tracker, the three portal inboxes and the owner's email. First contact needs positive evidence of earlier contact about this flat; follow-ups look for a message that already did that template's job. Ambiguous cases, such as the same landlord on another flat, are skipped and reported "check manually". Once a send might have happened, the routine never sends again.
- **Replies:** logged with `intent` viewing-invite | documents-request | rejection | question | other. A reply without `date` is a repeat when the same text, from and via already exist. A viewing invitation becomes a proposal with its times that the owner confirms (one time) or declines on the listing, also on an already rejected listing; only a confirmed viewing can be confirmed to the landlord. A documents request records the types and sets `docs-requested`; documents still leave only through a share the owner creates. A rejection sets `rejected` and cancels open proposals and confirmed viewings.
- **Pause:** a switch in the page header (with today's count against the cap) stops new slots at once; the routine re-checks the status right before every send click. A message already mid-send can still go out. Reading and adding continue.
- **Never:** documents or share links from the routine, messages in the routine's own words, a second message for the same slot, ImmoScout24.
- **Phase-1 limits fixed:** `POST /api/sync` follows warm and cold rent for rent listings and the price for buy listings, with price history and log; "Recalculate commute" runs in a background job (202 and a status endpoint).

## Security

- `SITE_PASSWORD` required (refuse to start without, unless `ALLOW_OPEN=1`), as in Car Hunt.
- `VAULT_KEY` required once the vault holds data.
- Public routes: `/healthz`, `/s/<token>` only.
- The routine authenticates with `SYNC_KEY` only and reaches an allow-list of routes; owner routes refuse any request carrying the sync key. Claims, `sent`, `release` and replies share one rate limit (60 a minute). JSON bodies on `/api/templates`, `/api/outreach` (claims, `sent`, `release`, pause), `/api/listings/:id/replies`, `/api/listings/:id/messages` and `/api/listings/:id/viewings` are limited to 64 KB (reply texts 5,000 characters); the listing upsert (`PUT /api/listings/:id`), `POST /api/sync` and the other JSON routes take up to 4 MB. The access gate runs before any body is read. Logs carry no message texts or applicant data.
- No personal data in the repository; checks grep a private pattern list before every push.

## Testing

- Server tests per phase (node:test, in-process `createApp`): profile validation, listing add/edit/delete with stubbed geo/commute calls, criteria and score units, affordability and purchase-cost maths, vault encrypt/decrypt round trip and wrong-key refusal, share creation/expiry/revocation/rate limit/watermark presence, red-flag matching.
- Browser check per phase: wizard on an empty data dir, add/edit/delete, desktop and phone, de/pt.
