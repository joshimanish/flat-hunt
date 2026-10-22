// public/area-sources.js — the data sources of the area analysis: name, licence, attribution, link. Page (window.AreaSources) and tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AreaSources = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // url = the dataset, licenceUrl = the licence text. {date} = date of retrieval (dd.mm.yyyy), {year} = year of retrieval; the page fills them from the listing's fetchedAt.
  const SOURCES = {
    osm: { name: "OpenStreetMap via Overpass API", licence: "ODbL 1.0", licenceUrl: "https://opendatacommons.org/licenses/odbl/", attribution: "© OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" },
    "osm-foot": { name: "FOSSGIS foot routing (routing.openstreetmap.de)", licence: "ODbL 1.0", licenceUrl: "https://opendatacommons.org/licenses/odbl/", attribution: "Routing: FOSSGIS e. V., data © OpenStreetMap contributors", url: "https://routing.openstreetmap.de/about.html" },
    "bfg-nz": { name: "BfG INSPIRE Natural Risk Zones (flood hazard maps HWRM-RL, 2nd cycle 2019)", licence: "GeoNutzV", licenceUrl: "https://www.gesetze-im-internet.de/geonutzv/", attribution: "WasserBLIcK/BfG; Zuständige Behörden der Länder, {date}", url: "https://geoportal.bafg.de/" },
    "nrw-noise": { name: "Umgebungslärmkartierung NRW 2022, round 4 (LANUK NRW)", licence: "dl-de/by-2-0", licenceUrl: "https://www.govdata.de/dl-de/by-2-0", attribution: "Land NRW (2022), dl-de/by-2-0", url: "https://www.umgebungslaerm-kartierung.nrw.de/" },
    "berlin-noise": { name: "Strategische Lärmkarten Berlin 2022 (Umweltatlas Berlin)", licence: "dl-de/zero-2-0", licenceUrl: "https://www.govdata.de/dl-de/zero-2-0", attribution: "Umweltatlas Berlin", url: "https://www.berlin.de/umweltatlas/" },
    "bka-pks": { name: "Polizeiliche Kriminalstatistik 2025, table T01 (Kreise)", licence: "dl-de/by-2-0", licenceUrl: "https://www.govdata.de/dl-de/by-2-0", attribution: "Bundeskriminalamt, Polizeiliche Kriminalstatistik 2025, dl-de/by-2-0", url: "https://www.bka.de/DE/AktuelleInformationen/StatistikenLagebilder/PolizeilicheKriminalstatistik/pks_node.html" },
    "bkg-vg250": { name: "Verwaltungsgebiete 1:250 000 (VG250), BKG", licence: "dl-de/by-2-0", licenceUrl: "https://www.govdata.de/dl-de/by-2-0", attribution: "© BKG ({year}) dl-de/by-2-0, Datenquellen: https://sg.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg_nuts.pdf", url: "https://gdz.bkg.bund.de/" },
    "zensus-rent": { name: "Zensus 2022, average net cold rent per m² (1 km grid)", licence: "dl-de/by-2-0", licenceUrl: "https://www.govdata.de/dl-de/by-2-0", attribution: "© Statistische Ämter des Bundes und der Länder, Zensus 2022, dl-de/by-2-0", url: "https://www.zensus2022.de/" }
  };
  const ORDER = ["osm", "osm-foot", "bfg-nz", "nrw-noise", "berlin-noise", "bka-pks", "bkg-vg250", "zensus-rent"];

  // Attribution with {date}/{year} filled from an ISO timestamp (or left as the bare text when none is given).
  function attribution(id, fetchedAt) {
    const s = SOURCES[id];
    if (!s) return "";
    const d = typeof fetchedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(fetchedAt) ? fetchedAt.slice(0, 10).split("-") : null;
    return s.attribution
      .replace("{date}", d ? `${d[2]}.${d[1]}.${d[0]}` : "")
      .replace("{year}", d ? d[0] : String(new Date().getFullYear()))
      .replace(/,\s*$/, "");
  }

  return { SOURCES, ORDER, attribution };
});
