// public/area-ui.js — the listing's "Area" panel, the flood and noise badges on the card, the area-rating tooltip and the sources footer.
// Every figure states its source, area level, data year and retrieval date. All text goes in through textContent.
(function () {
  const isNode = typeof window === "undefined";
  const Criteria = isNode ? require("./criteria") : window.Criteria;
  const AreaSources = isNode ? require("./area-sources") : window.AreaSources;

  const PLACES = ["transit", "supermarket", "pharmacy", "doctors", "kindergarten", "school", "park", "playground"];
  const NOISE_KINDS = ["road", "rail", "tram", "air", "industry"];

  const L = {
    en: {
      locale: "en-GB", title: "Area", asOf: d => `as of ${d}`, recompute: "Recompute", computing: "Being computed …",
      queuedLong: "Being computed … (the free map services are slow; this can take a few minutes)",
      noCoords: "Needs an address that can be found on the map.", notYet: "Not computed yet", startFail: "Could not start the computation.",
      error: e => `Could not be fetched (${e}). Try Recompute later.`, noData: "No data for this point.",
      level: { walk: "within walking distance (1 km, stops 500 m)", point: "at this address", kreis: "whole Kreis / district-free city", "cell-1km": "1 km grid square" },
      dataYear: y => `data ${y}`, refDate: d => `reference date ${d}`, retrieved: d => `retrieved ${d}`, cached: "from the 30-day cache",
      h: { places: "Everyday places", flood: "Flood hazard", noise: "Noise", crime: "Recorded crime", rent: "Average rent of existing tenancies 2022 (1 km cell)", price: "Price per m² among your listings" },
      cols: ["Place", "Nearest", "On foot"],
      place: { transit: "Transit stop", supermarket: "Supermarket", pharmacy: "Pharmacy", doctors: "Doctor", kindergarten: "Kindergarten", school: "School", park: "Park", playground: "Playground" },
      none: "none within 1 km", noneStop: "none within 500 m", noName: "(no name)", min: "min", estimated: "estimated",
      estTip: "straight-line estimate; the walking router did not answer",
      mode: { bus: "bus", trolleybus: "trolleybus", tram: "tram", subway: "underground", light_rail: "light rail", train: "train", monorail: "monorail", ferry: "ferry" },
      flood: {
        high: "Inside the area flooded by frequent floods (HQhäufig) on the official flood hazard maps.",
        medium: "Inside the 100-year flood area (HQ100) on the official flood hazard maps.",
        low: "Only inside the extreme-flood area (HQextrem), for example behind dikes.",
        unknown: "Inside a mapped flood area on the official flood hazard maps; the class is not stated (mapped flood area, class not stated).",
        none: "No mapped flood area was found at this point. The federal maps do not guarantee complete coverage, so this is not a statement that there is no flood risk.",
        note: "River and coastal flooding only; heavy-rain flooding (Starkregen) is not covered."
      },
      noiseKind: { road: "road traffic", rail: "federal railway", tram: "tram and other rail", air: "air traffic", industry: "industry" },
      noiseMax: (band, src) => `Mapped noise level ${band} dB(A) Lden (day-evening-night average), loudest source: ${src}`,
      noiseNone: noRail => `No mapped noise source at or above 55 dB(A) Lden at this point. Only major roads, ${noRail ? "" : "railways, "}airports and industry are mapped, so this does not mean quiet.`,
      noiseUncovered: "Federal railways (S-Bahn, DB) are not included in this map.", ebaLink: "EBA noise map", ebaUrl: "https://laermkartierung1.eisenbahn-bundesamt.de/",
      noiseOff: "Not mapped: noise maps are connected for North Rhine-Westphalia and Berlin only.",
      kind: { KfS: "district-free city", SK: "district-free city", LK: "district", K: "district", RV: "regional association" },
      crime: (k, y, t, n, r) => `Recorded crime in ${k} (${y}): ${t} cases per 100,000 residents. Germany: ${n} (${r} ×).`,
      violent: (x, y) => `Violent crime: ${x} (Germany ${y})`, burglary: (x, y) => `Residential burglary: ${x} (Germany ${y})`,
      crimeNote: "An average for the whole Kreis or district-free city, not for this street. Crimes are counted where they happen, so city centres, stations and nightlife areas raise the figure. It does not measure how safe this address is.",
      crimeNone: "No police statistics for this area.",
      rent: x => `Average net cold rent of existing tenancies in this 1 km square (census, 15 May 2022): ${x}.`,
      rentOwn: (y, z) => `This listing's asking rent per m²: ${y} cold (${z} %).`,
      rentNote: "Existing tenancies in 2022 — not today's asking rents and not a Mietspiegel.",
      rentNone: "No census rent for this square (too few rented flats or kept secret).",
      price: (w, m, n, z) => `Your tracked listings in ${w}: median ${m} (${n} listings); this one ${z} %.`,
      priceNote: "No external source: the asking rent (cold, else warm) or price per m² of your own tracked listings of the same kind.",
      badge: { high: "Flood area (frequent)", medium: "Flood area HQ100", noise: b => `Noise ${b} dB`, queued: "Area …", queuedTip: "Area facts are being computed" },
      tip: {
        formula: "Area estimate: everyday places within walking distance give 0–10 (six groups: transit stop, supermarket, pharmacy, doctor, kindergarten or school, park or playground; full points up to 5 min, ¾ up to 10, ½ up to 15, ¼ up to 20), minus flood area (frequent 3, HQ100 2, extreme only or class not stated 0.5), mapped noise (from 70 dB 2, from 65 1.5, from 60 1, from 55 0.5) and recorded crime in the Kreis against Germany (from 1.5 × 1, from 1.2 × 0.5); rounded, 0–10.",
        line: "Area ≈", part: { everyday: "everyday places", flood: "flood", noise: "noise", crime: "crime" },
        skipped: s => `Not counted (no data or could not be fetched): ${s}.`, estimated: "Some walking times are straight-line estimates (the walking router did not answer).", unrated: "Area not rated yet: the everyday places are not computed."
      },
      footer: "Data sources", dateSee: "date of retrieval, see each listing",
      footerMap: "Map and geocoding © OpenStreetMap contributors (ODbL); routing OSRM, FOSSGIS, Transitous."
    },
    de: {
      locale: "de-DE", title: "Umgebung", asOf: d => `Stand ${d}`, recompute: "Neu berechnen", computing: "Wird berechnet …",
      queuedLong: "Wird berechnet … (die freien Kartendienste sind langsam; das kann ein paar Minuten dauern)",
      noCoords: "Braucht eine Adresse, die auf der Karte gefunden wird.", notYet: "Noch nicht berechnet", startFail: "Die Berechnung konnte nicht gestartet werden.",
      error: e => `Konnte nicht abgerufen werden (${e}). Später „Neu berechnen“ versuchen.`, noData: "Keine Daten für diesen Punkt.",
      level: { walk: "in Gehweite (1 km, Haltestellen 500 m)", point: "an dieser Adresse", kreis: "ganzer Kreis / kreisfreie Stadt", "cell-1km": "1-km-Gitterzelle" },
      dataYear: y => `Datenstand ${y}`, refDate: d => `Stichtag ${d}`, retrieved: d => `abgerufen ${d}`, cached: "aus dem 30-Tage-Zwischenspeicher",
      h: { places: "Alltagsorte", flood: "Hochwassergefahr", noise: "Lärm", crime: "Erfasste Kriminalität", rent: "Durchschnittsmiete bestehender Mietverhältnisse 2022 (1-km-Zelle)", price: "Preis je m² unter deinen Inseraten" },
      cols: ["Ort", "Nächster", "Zu Fuß"],
      place: { transit: "Haltestelle", supermarket: "Supermarkt", pharmacy: "Apotheke", doctors: "Arztpraxis", kindergarten: "Kita", school: "Schule", park: "Park", playground: "Spielplatz" },
      none: "keiner im Umkreis von 1 km", noneStop: "keine im Umkreis von 500 m", noName: "(ohne Namen)", min: "Min.", estimated: "geschätzt",
      estTip: "Luftlinien-Schätzung; der Fußwege-Router hat nicht geantwortet",
      mode: { bus: "Bus", trolleybus: "Oberleitungsbus", tram: "Straßenbahn", subway: "U-Bahn", light_rail: "Stadtbahn", train: "Zug", monorail: "Einschienenbahn", ferry: "Fähre" },
      flood: {
        high: "Innerhalb der Fläche häufiger Hochwasser (HQhäufig) in den amtlichen Hochwassergefahrenkarten.",
        medium: "Innerhalb der Fläche eines 100-jährlichen Hochwassers (HQ100) in den amtlichen Hochwassergefahrenkarten.",
        low: "Nur innerhalb der Fläche eines Extremhochwassers (HQextrem), zum Beispiel hinter Deichen.",
        unknown: "Innerhalb einer kartierten Hochwasserfläche in den amtlichen Hochwassergefahrenkarten; die Klasse ist nicht angegeben (kartierte Hochwasserfläche, Klasse nicht angegeben).",
        none: "An diesem Punkt wurde keine kartierte Hochwasserfläche gefunden. Die Bundeskarten garantieren keine vollständige Abdeckung, daher ist das keine Aussage, dass kein Hochwasserrisiko besteht.",
        note: "Nur Fluss- und Küstenhochwasser; Überflutung durch Starkregen ist nicht erfasst."
      },
      noiseKind: { road: "Straßenverkehr", rail: "Eisenbahn des Bundes", tram: "Straßenbahn und sonstige Schienenwege", air: "Flugverkehr", industry: "Industrie" },
      noiseMax: (band, src) => `Kartierter Lärmpegel ${band} dB(A) Lden (Mittel über Tag, Abend und Nacht), lauteste Quelle: ${src}`,
      noiseNone: noRail => `An diesem Punkt keine kartierte Lärmquelle ab 55 dB(A) Lden. Kartiert sind nur Hauptverkehrsstraßen, ${noRail ? "" : "Schienenwege, "}Flughäfen und Industrie, das heißt also nicht, dass es ruhig ist.`,
      noiseUncovered: "Eisenbahnen des Bundes (S-Bahn, DB) sind in dieser Karte nicht enthalten.", ebaLink: "Lärmkarte des EBA", ebaUrl: "https://laermkartierung1.eisenbahn-bundesamt.de/",
      noiseOff: "Nicht kartiert: Lärmkarten sind nur für Nordrhein-Westfalen und Berlin angebunden.",
      kind: { KfS: "kreisfreie Stadt", SK: "Stadtkreis", LK: "Landkreis", K: "Kreis", RV: "Regionalverband" },
      crime: (k, y, t, n, r) => `Polizeilich erfasste Straftaten in ${k} (${y}): ${t} Fälle je 100.000 Einwohner. Deutschland: ${n} (${r}-fach).`,
      violent: (x, y) => `Gewaltkriminalität: ${x} (Deutschland ${y})`, burglary: (x, y) => `Wohnungseinbruch: ${x} (Deutschland ${y})`,
      crimeNote: "Ein Durchschnitt für den ganzen Kreis bzw. die kreisfreie Stadt, nicht für diese Straße. Straftaten werden dort gezählt, wo sie geschehen, deshalb erhöhen Innenstädte, Bahnhöfe und Ausgehviertel den Wert. Er misst nicht, wie sicher diese Adresse ist.",
      crimeNone: "Keine Polizeistatistik für dieses Gebiet.",
      rent: x => `Durchschnittliche Nettokaltmiete bestehender Mietverhältnisse in diesem 1-km-Quadrat (Zensus, 15. Mai 2022): ${x}.`,
      rentOwn: (y, z) => `Angebotsmiete je m² dieses Inserats: ${y} kalt (${z} %).`,
      rentNote: "Bestandsmieten von 2022 – keine heutigen Angebotsmieten und kein Mietspiegel.",
      rentNone: "Keine Zensusmiete für dieses Quadrat (zu wenige Mietwohnungen oder geheim gehalten).",
      price: (w, m, n, z) => `Deine erfassten Inserate in ${w}: Median ${m} (${n} Inserate); dieses ${z} %.`,
      priceNote: "Keine externe Quelle: Angebotsmiete (kalt, sonst warm) bzw. Kaufpreis je m² deiner eigenen erfassten Inserate derselben Art.",
      badge: { high: "Hochwasserfläche (häufig)", medium: "Hochwasserfläche HQ100", noise: b => `Lärm ${b} dB`, queued: "Umgebung …", queuedTip: "Die Umgebungsdaten werden berechnet" },
      tip: {
        formula: "Umgebungsschätzung: Alltagsorte in Gehweite ergeben 0–10 (sechs Gruppen: Haltestelle, Supermarkt, Apotheke, Arzt, Kita oder Schule, Park oder Spielplatz; volle Punkte bis 5 Min., ¾ bis 10, ½ bis 15, ¼ bis 20), abzüglich Hochwasserfläche (häufig 3, HQ100 2, nur extrem oder Klasse nicht angegeben 0,5), kartiertem Lärm (ab 70 dB 2, ab 65 1,5, ab 60 1, ab 55 0,5) und erfasster Kriminalität im Kreis gegenüber Deutschland (ab 1,5-fach 1, ab 1,2-fach 0,5); gerundet, 0–10.",
        line: "Umgebung ≈", part: { everyday: "Alltagsorte", flood: "Hochwasser", noise: "Lärm", crime: "Kriminalität" },
        skipped: s => `Nicht gezählt (keine Daten oder nicht abrufbar): ${s}.`, estimated: "Einige Gehzeiten sind Luftlinien-Schätzungen (der Fußgänger-Router hat nicht geantwortet).", unrated: "Umgebung noch nicht bewertet: die Alltagsorte sind noch nicht berechnet."
      },
      footer: "Datenquellen", dateSee: "Abrufdatum, siehe jedes Inserat",
      footerMap: "Karte und Geokodierung © OpenStreetMap-Mitwirkende (ODbL); Routing OSRM, FOSSGIS, Transitous."
    },
    pt: {
      locale: "pt-BR", title: "Região", asOf: d => `em ${d}`, recompute: "Recalcular", computing: "Sendo calculado …",
      queuedLong: "Sendo calculado … (os serviços de mapa gratuitos são lentos; isso pode levar alguns minutos)",
      noCoords: "Precisa de um endereço que possa ser encontrado no mapa.", notYet: "Ainda não calculado", startFail: "Não foi possível iniciar o cálculo.",
      error: e => `Não foi possível obter (${e}). Tente Recalcular mais tarde.`, noData: "Sem dados para este ponto.",
      level: { walk: "a pé (1 km, paradas 500 m)", point: "neste endereço", kreis: "Kreis inteiro / cidade independente", "cell-1km": "quadrícula de 1 km" },
      dataYear: y => `dados de ${y}`, refDate: d => `data de referência ${d}`, retrieved: d => `obtido em ${d}`, cached: "do cache de 30 dias",
      h: { places: "Lugares do dia a dia", flood: "Perigo de inundação", noise: "Ruído", crime: "Criminalidade registrada", rent: "Aluguel médio de contratos existentes 2022 (célula de 1 km)", price: "Preço por m² entre seus anúncios" },
      cols: ["Local", "Mais próximo", "A pé"],
      place: { transit: "Parada de transporte", supermarket: "Supermercado", pharmacy: "Farmácia", doctors: "Médico", kindergarten: "Creche", school: "Escola", park: "Parque", playground: "Parquinho" },
      none: "nenhum num raio de 1 km", noneStop: "nenhuma num raio de 500 m", noName: "(sem nome)", min: "min", estimated: "estimado",
      estTip: "estimativa em linha reta; o roteador a pé não respondeu",
      mode: { bus: "ônibus", trolleybus: "trólebus", tram: "bonde", subway: "metrô", light_rail: "VLT", train: "trem", monorail: "monotrilho", ferry: "balsa" },
      flood: {
        high: "Dentro da área atingida por cheias frequentes (HQhäufig) nos mapas oficiais de perigo de inundação.",
        medium: "Dentro da área de cheia de 100 anos (HQ100) nos mapas oficiais de perigo de inundação.",
        low: "Apenas dentro da área de cheia extrema (HQextrem), por exemplo atrás de diques.",
        unknown: "Dentro de uma área de inundação mapeada nos mapas oficiais de perigo de inundação; a classe não é informada (área de inundação mapeada, classe não informada).",
        none: "Nenhuma área de inundação mapeada foi encontrada neste ponto. Os mapas federais não garantem cobertura completa, então isso não significa que não haja risco de inundação.",
        note: "Apenas cheias de rios e costeiras; inundações por chuva forte (Starkregen) não estão incluídas."
      },
      noiseKind: { road: "tráfego rodoviário", rail: "ferrovia federal", tram: "bonde e outros trilhos", air: "tráfego aéreo", industry: "indústria" },
      noiseMax: (band, src) => `Nível de ruído mapeado ${band} dB(A) Lden (média dia-tarde-noite), fonte mais alta: ${src}`,
      noiseNone: noRail => `Nenhuma fonte de ruído mapeada a partir de 55 dB(A) Lden neste ponto. Só são mapeadas vias principais, ${noRail ? "" : "ferrovias, "}aeroportos e indústria, então isso não significa silêncio.`,
      noiseUncovered: "As ferrovias federais (S-Bahn, DB) não estão incluídas neste mapa.", ebaLink: "Mapa de ruído do EBA", ebaUrl: "https://laermkartierung1.eisenbahn-bundesamt.de/",
      noiseOff: "Não mapeado: os mapas de ruído estão conectados apenas para a Renânia do Norte-Vestfália e Berlim.",
      kind: { KfS: "cidade independente", SK: "cidade independente", LK: "distrito", K: "distrito", RV: "associação regional" },
      crime: (k, y, t, n, r) => `Crimes registrados pela polícia em ${k} (${y}): ${t} casos por 100 mil habitantes. Alemanha: ${n} (${r} ×).`,
      violent: (x, y) => `Crimes violentos: ${x} (Alemanha ${y})`, burglary: (x, y) => `Arrombamento de residências: ${x} (Alemanha ${y})`,
      crimeNote: "Uma média para todo o Kreis ou cidade independente, não para esta rua. Os crimes são contados onde acontecem, então centros, estações e áreas de vida noturna elevam o número. Isso não mede a segurança deste endereço.",
      crimeNone: "Sem estatística policial para esta área.",
      rent: x => `Aluguel líquido frio médio dos contratos existentes neste quadrado de 1 km (censo, 15 de maio de 2022): ${x}.`,
      rentOwn: (y, z) => `Aluguel pedido por m² deste anúncio: ${y} frio (${z} %).`,
      rentNote: "Contratos existentes em 2022 — não são os aluguéis pedidos hoje nem um Mietspiegel.",
      rentNone: "Sem aluguel do censo para este quadrado (poucos imóveis alugados ou dado sigiloso).",
      price: (w, m, n, z) => `Seus anúncios em ${w}: mediana ${m} (${n} anúncios); este ${z} %.`,
      priceNote: "Sem fonte externa: aluguel pedido (frio, senão total) ou preço por m² dos seus próprios anúncios do mesmo tipo.",
      badge: { high: "Área de inundação (frequente)", medium: "Área de inundação HQ100", noise: b => `Ruído ${b} dB`, queued: "Região …", queuedTip: "Os dados da região estão sendo calculados" },
      tip: {
        formula: "Estimativa da região: lugares do dia a dia a pé dão 0–10 (seis grupos: parada de transporte, supermercado, farmácia, médico, creche ou escola, parque ou parquinho; pontos cheios até 5 min, ¾ até 10, ½ até 15, ¼ até 20), menos área de inundação (frequente 3, HQ100 2, só extrema ou classe não informada 0,5), ruído mapeado (a partir de 70 dB 2, de 65 1,5, de 60 1, de 55 0,5) e criminalidade registrada no Kreis em relação à Alemanha (a partir de 1,5 × 1, de 1,2 × 0,5); arredondado, 0–10.",
        line: "Região ≈", part: { everyday: "lugares do dia a dia", flood: "inundação", noise: "ruído", crime: "criminalidade" },
        skipped: s => `Não contados (sem dados ou não obtidos): ${s}.`, estimated: "Alguns tempos a pé são estimativas em linha reta (o roteador a pé não respondeu).", unrated: "Região ainda não avaliada: os lugares do dia a dia não foram calculados."
      },
      footer: "Fontes de dados", dateSee: "data de consulta, ver cada anúncio",
      footerMap: "Mapa e geocodificação © colaboradores do OpenStreetMap (ODbL); rotas OSRM, FOSSGIS, Transitous."
    }
  };

  const Lof = lang => L[lang] || L.en;
  const nf = (lang, n, d = 0) => new Intl.NumberFormat(Lof(lang).locale, { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n);
  const eurSqm = (lang, n) => new Intl.NumberFormat(Lof(lang).locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + "/m²";
  const date = (lang, iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString(Lof(lang).locale, { day: "2-digit", month: "2-digit", year: "numeric" }) : ""; };
  // Share above (+) or below (−) as a signed whole percentage, e.g. "+8", "−12", "0".
  const signed = (lang, share) => { const v = Math.round(share * 100); return (v > 0 ? "+" : v < 0 ? "−" : "") + nf(lang, Math.abs(v)); };
  const bandOf = v => v == null ? null : v >= 75 ? "75+" : `${v}–${v + 4}`;
  const fig = (area, k) => area && area[k] && typeof area[k] === "object" ? area[k] : null;

  // ---------- rating tooltip (plain text) ----------
  function ratingTip(listing, lang) {
    const T = Lof(lang).tip, area = listing && listing.area;
    const r = Criteria.areaRating(area);
    if (!r) return T.unrated;
    const n = v => nf(lang, Math.abs(v), 1);
    const line = r.parts.map((p, i) => (i === 0 ? "" : " − ") + `${T.part[p.key] || p.key} ${n(p.value)}`).join("");
    const out = [T.formula, `${T.line} ${nf(lang, r.value)} = ${line}`];
    const skipped = ["flood", "noise", "crime"].filter(k => { const f = fig(area, k); return !f || f.status === "no-data" || f.status === "error"; });
    if (skipped.length) out.push(T.skipped(skipped.map(k => T.part[k]).join(", ")));
    const items = fig(area, "amenities") && fig(area, "amenities").items;
    if (items && Object.values(items).some(it => it && it.estimated)) out.push(T.estimated);
    return out.join("\n");
  }

  // Note for kinds the noise map does not contain (Berlin: federal railways) → { text, href, linkText } or null.
  function noiseUncoveredNote(f, lang) {
    if (!f || !Array.isArray(f.uncovered) || !f.uncovered.includes("rail")) return null;
    const T = Lof(lang);
    return /^https:\/\//.test(T.ebaUrl) ? { text: T.noiseUncovered, href: T.ebaUrl, linkText: T.ebaLink } : null;
  }

  // Badge tooltip: "<source name> · <data year>"; just the year when the source entry is unknown.
  const noiseBadgeTitle = (name, year, dy) => (name ? name + " · " : "") + dy(year);

  if (isNode) { module.exports = { L, ratingTip, bandOf, signed, noiseBadgeTitle, noiseUncoveredNote }; return; }

  // ---------- DOM helpers ----------
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const link = (href, txt) => { const a = el("a", null, txt); if (/^https?:\/\//.test(href || "")) { a.href = href; a.target = "_blank"; a.rel = "noopener"; } return a; };

  // Muted source line: "<source name> · <area level> · <data year or reference date> · retrieved <date> · <licence link>".
  function sourceLine(lang, f, extra) {
    const T = Lof(lang), p = el("p", "area-src");
    const ids = [f.source].concat(extra || []).filter(id => id && AreaSources.SOURCES[id]);
    ids.forEach((id, i) => {
      const s = AreaSources.SOURCES[id];
      if (i) p.append(document.createTextNode(" · "));
      const bits = [s.name];
      if (i === 0) {
        if (T.level[f.level]) bits.push(T.level[f.level]);
        if (f.refDate) bits.push(T.refDate(date(lang, f.refDate)));
        else { const y = f.dataYear || f.year; if (y) bits.push(T.dataYear(y)); }
        if (f.fetchedAt) bits.push(T.retrieved(date(lang, f.fetchedAt)));
        if (f.cached) bits.push(T.cached);
      }
      const rest = bits.slice(1), name = link(s.url, s.name), span = el("span", null, (rest.length ? " · " + rest.join(" · ") : "") + " · ");
      name.title = span.title = AreaSources.attribution(id, f.fetchedAt);
      p.append(name, span, link(s.licenceUrl, s.licence));
    });
    return p;
  }

  function block(host, heading) { const b = el("div", "area-fig"); b.append(el("h4", null, heading)); host.append(b); return b; }
  // A failed figure says only that it failed; returns true when the caller should stop.
  function failed(b, lang, f) {
    if (!f) { b.append(el("p", "area-txt", Lof(lang).noData)); return true; }
    if (f.status === "error") { b.append(el("p", "area-txt", Lof(lang).error(f.error || "?"))); return true; }
    return false;
  }

  function placesBlock(host, lang, f) {
    const T = Lof(lang), b = block(host, T.h.places);
    if (failed(b, lang, f)) return;
    const wrap = el("div", "area-places"), t = el("table", "ctable"), hr = el("tr"), th = el("thead"), tb = el("tbody");
    T.cols.forEach((c, i) => hr.append(el("th", i === 2 ? "num" : null, c))); th.append(hr); t.append(th);
    const items = f.items || {};
    PLACES.forEach(cat => {
      const it = items[cat], tr = el("tr");
      tr.append(el("td", null, T.place[cat]));
      if (!it) { tr.append(el("td", "unk", cat === "transit" ? T.noneStop : T.none), el("td", "num unk", "–")); tb.append(tr); return; }
      const name = el("td"); name.append(document.createTextNode(it.name || T.noName));
      if (Array.isArray(it.lines) && it.lines.length) {
        const chips = el("span", "area-lines");
        it.lines.forEach(ln => { const ch = el("span", "area-line", ln.ref); if (ln.mode) ch.title = T.mode[ln.mode] || ln.mode; chips.append(ch); });
        name.append(chips);
      }
      const m = el("td", "num");
      if (typeof it.minutes === "number") {
        m.append(document.createTextNode((it.estimated ? "≈ " : "") + `${nf(lang, it.minutes)} ${T.min}`));
        if (it.estimated) { m.title = T.estTip; m.append(el("small", "area-est", T.estimated)); }
      } else m.textContent = "–";
      tr.append(name, m); tb.append(tr);
    });
    t.append(tb); wrap.append(t); b.append(wrap);
    b.append(sourceLine(lang, f, f.routing === "osm-foot" ? ["osm-foot"] : []));
  }

  function floodBlock(host, lang, f) {
    const T = Lof(lang), b = block(host, T.h.flood);
    if (failed(b, lang, f)) return;
    const txt = f.status === "ok" ? T.flood[f.worst] || T.flood.unknown : T.flood.none;
    b.append(el("p", "area-txt" + (f.status === "ok" && (f.worst === "high" || f.worst === "medium") ? " warn" : ""), txt), el("p", "area-note", T.flood.note), sourceLine(lang, f));
  }

  function noiseBlock(host, lang, f, area) {
    const T = Lof(lang), b = block(host, T.h.noise);
    if (failed(b, lang, f)) return;
    if (f.status !== "ok") {
      const k = fig(area, "kreis");
      b.append(el("p", "area-txt", k && k.status === "ok" ? T.noiseOff : T.noData));
      return;
    }
    const noRail = Array.isArray(f.uncovered) && f.uncovered.includes("rail");
    if (f.max == null) b.append(el("p", "area-txt", T.noiseNone(noRail)));
    else {
      b.append(el("p", "area-txt", T.noiseMax(f.band || bandOf(f.max), T.noiseKind[f.dominant] || f.dominant || "?")));
      const ul = el("ul", "area-list");
      NOISE_KINDS.forEach(k => { const v = f.lden && f.lden[k]; if (typeof v === "number") ul.append(el("li", null, `${T.noiseKind[k]}: ${bandOf(v)} dB(A)`)); });
      if (ul.childElementCount) b.append(ul);
    }
    const note = noiseUncoveredNote(f, lang);
    if (note) { const u = el("p", "area-note", note.text + " "); u.append(link(note.href, note.linkText)); b.append(u); }
    b.append(sourceLine(lang, f));
  }

  function crimeBlock(host, lang, f) {
    const T = Lof(lang), b = block(host, T.h.crime);
    if (failed(b, lang, f)) return;
    if (f.status !== "ok") { b.append(el("p", "area-txt", T.crimeNone)); return; }
    const hz = f.hz || {}, nat = f.national || {}, ratio = f.ratio || {};
    const name = f.kreis + (T.kind[f.kind] ? ", " + T.kind[f.kind] : "");
    const num = v => typeof v === "number" ? nf(lang, v) : "–";
    b.append(el("p", "area-txt", T.crime(name, f.year, num(hz.total), num(nat.total), ratio.total != null ? nf(lang, ratio.total, 2) : "–")));
    const ul = el("ul", "area-list");
    if (typeof hz.violent === "number") ul.append(el("li", null, T.violent(num(hz.violent), num(nat.violent))));
    if (typeof hz.burglary === "number") ul.append(el("li", null, T.burglary(num(hz.burglary), num(nat.burglary))));
    if (ul.childElementCount) b.append(ul);
    b.append(el("p", "area-note", T.crimeNote), sourceLine(lang, f, ["bkg-vg250"]));
  }

  function rentBlock(host, lang, f, c) {
    const T = Lof(lang), b = block(host, T.h.rent);
    if (failed(b, lang, f)) return;
    if (f.status !== "ok") { b.append(el("p", "area-txt", T.rentNone)); return; }
    b.append(el("p", "area-txt", T.rent(eurSqm(lang, f.eurPerSqm))));
    const cold = Number(c.coldRent), size = Number(c.size);
    if (c.mode === "rent" && c.coldRent != null && c.coldRent !== "" && cold > 0 && size > 0 && f.eurPerSqm > 0) {
      const own = cold / size;
      b.append(el("p", "area-txt", T.rentOwn(eurSqm(lang, own), signed(lang, own / f.eurPerSqm - 1))));
    }
    b.append(el("p", "area-note", T.rentNote), sourceLine(lang, f));
  }

  function priceBlock(host, lang, c, listings) {
    const T = Lof(lang), pc = Criteria.priceCheck(c, listings || []);
    if (!pc) return;
    const b = block(host, T.h.price);
    const where = pc.level === "postcode" ? c.postcode : c.city;
    b.append(el("p", "area-txt", T.price(where, eurSqm(lang, pc.median), nf(lang, pc.n), signed(lang, pc.diff))), el("p", "area-src", T.priceNote));
  }

  // ---------- panel ----------
  function panel(host, listing, opts) {
    const o = opts || {}, lang = o.lang, T = Lof(lang), c = listing, area = c.area;
    host.textContent = "";
    const head = el("div", "area-head");
    const h = el("h3", "sp", T.title); head.append(h);
    if (area && area.computedAt) head.append(el("span", "muted area-asof", T.asOf(date(lang, area.computedAt))));
    host.append(head);
    const hasCoords = typeof c.lat === "number" && typeof c.lon === "number";
    if (!hasCoords) { host.append(el("p", "area-txt muted", T.noCoords)); return host; }
    const status = el("p", "area-status muted");
    const btn = el("button", "btn", T.recompute); btn.type = "button";
    const busy = () => { btn.disabled = true; btn.hidden = true; status.textContent = area ? T.computing : T.queuedLong; };
    btn.onclick = async e => {
      e.stopPropagation(); btn.disabled = true;
      try {
        const r = await fetch("/api/listings/" + encodeURIComponent(c.id) + "/area", { method: "POST" });
        if (r.status !== 202) throw new Error(r.status);
        busy();
        if (o.onChanged) o.onChanged();
      } catch (err) { btn.disabled = false; status.textContent = T.startFail; }
    };
    head.append(btn);
    if (o.queued) busy();
    else if (!area) status.textContent = T.notYet;
    host.append(status);
    if (!area) return host;
    const blocks = el("div", "area-blocks");
    placesBlock(blocks, lang, fig(area, "amenities"));
    floodBlock(blocks, lang, fig(area, "flood"));
    noiseBlock(blocks, lang, fig(area, "noise"), area);
    crimeBlock(blocks, lang, fig(area, "crime"));
    rentBlock(blocks, lang, fig(area, "rent"), c);
    priceBlock(blocks, lang, c, o.listings);
    host.append(blocks);
    return host;
  }

  // ---------- card badges ----------
  function badges(listing, opts) {
    const o = opts || {}, lang = o.lang, T = Lof(lang).badge, out = [], area = listing && listing.area;
    const S = AreaSources.SOURCES, dy = Lof(lang).dataYear;
    const fl = fig(area, "flood"), no = fig(area, "noise");
    if (fl && fl.status === "ok" && (fl.worst === "high" || fl.worst === "medium")) {
      const b = el("span", "vu-badge warn", T[fl.worst]); b.title = `${S["bfg-nz"].name} · ${dy(fl.dataYear || 2019)}`; out.push(b);
    }
    if (no && no.status === "ok" && typeof no.max === "number" && no.max >= 65) {
      const b = el("span", "vu-badge warn", T.noise(no.band || bandOf(no.max)));
      b.title = noiseBadgeTitle(S[no.source] && S[no.source].name, no.dataYear || 2022, dy); out.push(b);
    }
    if (o.queued) { const b = el("span", "vu-badge muted", T.queued); b.title = T.queuedTip; out.push(b); }
    return out;
  }

  // ---------- footer ----------
  function footer(host, lang) {
    const T = Lof(lang);
    host.textContent = "";
    host.append(el("h3", null, T.footer));
    const ul = el("ul");
    const year = String(new Date().getFullYear());
    AreaSources.ORDER.forEach(id => {
      const s = AreaSources.SOURCES[id]; if (!s) return;
      const li = el("li");
      const attr = s.attribution.replace("{date}", T.dateSee).replace("{year}", year);
      li.append((() => { const b = el("b"); b.append(link(s.url, s.name)); return b; })(), document.createTextNode(" — " + attr + " — "), link(s.licenceUrl, s.licence));
      ul.append(li);
    });
    ul.append(el("li", null, T.footerMap));
    host.append(ul);
    return host;
  }

  window.AreaUI = { panel, badges, ratingTip, footer, L };
})();
