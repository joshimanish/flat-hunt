// public/setup.js — first-launch wizard, Settings panel and the add/edit listing dialog.
(function () {
  const LANGS = ["en", "de", "pt"];
  const PLACE_MODES = ["car", "transit", "bike"];
  const STATES = ["BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH"];
  const WEIGHT_KEYS = ["price", "size", "commute", "area", "condition", "contact"];
  const MAX_PLACES = 5;
  const RENT_FIELDS = ["coldRent", "utilities", "warmRent", "deposit", "takeover"], BUY_FIELDS = ["price"];
  const L = {
    en: {
      wizard: "Set up your flat hunt", settings: "Settings", next: "Next", back: "Back", save: "Save", cancel: "Cancel", finish: "Start tracking",
      steps: ["Welcome and income", "Rent or buy", "The flat", "Where", "Red flags and weights", "Contacting landlords"],
      intro: "Flat Hunt keeps track of the flats you are considering, to rent or to buy: costs, size, travel times to the places that matter to you, warning signs and your conversations with landlords, ranked by what matters to you. Everything you set here can be changed later in Settings.",
      name: "Name of this hunt", languages: "Languages on the page", needLang: "Please tick at least one language.",
      netIncome: "Household net income per month (€)", netIncomeHint: "Leave it at 0 if you prefer; the affordability check is then skipped.",
      affordShare: "Share of income for housing", affordHint: "How much of the net income rent or loan payments may take. About a third is a common rule of thumb; listings above it are marked as tight or too much.",
      modesQ: "What are you looking for?", rent: "Rent a flat", buy: "Buy a flat", needMode: "Please tick rent, buy or both.",
      maxWarm: "Max warm rent (€ per month)", maxCold: "Max cold rent (€ per month, optional)", maxDeposit: "Max deposit (€, optional)", maxTakeover: "Max takeover payment (€, optional)",
      maxPrice: "Max purchase price (€)", equity: "Own funds (€)", apr: "Interest (% per year)", years: "Loan term (years)", state: "Federal state (land transfer tax)", agentFeePct: "Agent fee (%)",
      taxHint: m => `Transfer tax rates as checked in ${m}; please confirm the current rate for your state.`,
      roomsMin: "Rooms at least", roomsMax: "Rooms at most (optional)", sizeMin: "Size at least (m²)", sizeMax: "Size at most (m², optional)", floorMin: "Floor from (optional)", floorMax: "Floor up to (optional)", floorHint: "-1 = basement, 0 = ground floor.", needsLift: "I need a lift",
      outdoor: "Outdoor space", outdoorOpt: { any: "Not important", balcony: "Balcony or garden", garden: "Garden" },
      kitchen: "Fitted kitchen", kitchenOpt: { any: "Not important", required: "Required" },
      pets: "I have pets (only flats where pets are allowed)", moveInFrom: "Move in from (optional)", moveInTo: "Move in by (optional)",
      wbs: "Housing permit (WBS)", wbsOpt: { none: "I have no WBS", have: "I have a WBS (WBS flats welcome)", exclude: "Hide WBS-only flats" },
      placesH: "Important places", placesHint: "Up to five places such as work, school or family, each with the longest trip you accept. A listing must meet every limit.",
      place: "Place", placeName: "Name", placePh: "e.g. Work", address: "Address", find: "Find", found: "Found:", notFound: "Address not found",
      travel: "Travel by", modes: { car: "Car", transit: "Public transport", bike: "Bike" }, maxMin: "Longest trip (min)", time: "Arrive by (weekday)",
      addPlace: "Add a place", remove: "Remove", noPlaces: "No places yet. Without places, travel times are not checked.",
      radiusH: "Radius (optional)", radiusHint: "Only flats within this distance of a centre point. Leave both empty for no radius.", radiusCenter: "Centre address", radiusKm: "Radius (km)",
      radiusBoth: "For the radius, find a centre address and enter the km, or leave both empty.",
      needPlaceName: n => `Please name place ${n}.`, needFind: x => `Please press Find for the address of “${x}”.`, needTime: x => `Please enter a time for “${x}”.`,
      redFlags: "Warn me about", redHint: "Listings whose text matches get a red flag. Hover an entry to see why it matters.",
      custom: "Add your own (name and words to match, e.g. “Cash only” and “cash only|nur bar”)", customLabel: "Name", customMatch: "Words to match", customOn: "Warn",
      badPattern: x => `The words to match for “${x}” are not a valid pattern.`,
      weights: "How much each part counts in the score", weightHint: "0 = ignore this part", weightsZero: "Please give at least one part a weight above 0.",
      w: { price: "Price", size: "Size", commute: "Commute", area: "Area", condition: "Condition", contact: "Landlord / contact" },
      outreach: "Let the Claude routine contact shortlisted landlords in my name", paused: "Paused for now", outLang: "Message language",
      outreachHint: "The website never sends messages itself. Your Claude routine sends only templates you approved below, at most the number per day you set, with the minimum gap between messages, never twice to the same listing, and never documents. The pause switch in the page header stops it at once.",
      minGapMin: "Minimum minutes between two messages", dailyCap: "Messages per day at most",
      templatesLater: "You edit and approve the message templates in Settings once the hunt is set up; nothing is sent before.", templatesSaveAtOnce: "Template buttons save at once; “Save” below stores the other settings.", pausedTip: "Change this with the pause switch in the page header.",
      lang: { en: "English", de: "Deutsch", pt: "Português" },
      needNumber: "Please enter a valid number for:", netFail: "Could not reach the server:", loadFail: "Could not load the red-flag list; you can still save.",
      notBelow: (a, b) => `“${a}” must not be below “${b}”.`,
      addListing: "Add a listing", editListing: "Edit listing", saveChanges: "Save changes", url: "Link to the listing", urlHint: "An https:// link", title: "Title",
      lmode: "Offered", lmodes: { rent: "To rent", buy: "To buy" }, postcode: "Postcode", city: "City",
      coldRent: "Cold rent (€ per month)", utilities: "Service charges (€ per month)", warmRent: "Warm rent (€ per month)", deposit: "Deposit (€)", takeover: "Takeover payment (€)", price: "Purchase price (€)",
      rooms: "Rooms", size: "Size (m²)", floor: "Floor", lift: "Lift", loutdoor: "Outdoor space", loutdoorOpt: { none: "None", balcony: "Balcony", garden: "Garden", both: "Balcony and garden" },
      lkitchen: "Fitted kitchen", petsAllowed: "Pets allowed", availableFrom: "Available from", wbsRequired: "WBS required",
      contactName: "Contact name", contactType: "Contact type", contactTypes: { private: "Private landlord", agent: "Agent", company: "Housing company" }, notes: "Notes",
      unknown: "–", yes: "Yes", no: "No",
      needWhere: "Please enter an address, or postcode and city.", needRent: "Please enter the cold or the warm rent.", needPrice: "Please enter the purchase price."
    },
    de: {
      wizard: "Wohnungssuche einrichten", settings: "Einstellungen", next: "Weiter", back: "Zurück", save: "Speichern", cancel: "Abbrechen", finish: "Los geht’s",
      steps: ["Willkommen und Einkommen", "Mieten oder kaufen", "Die Wohnung", "Wo", "Warnzeichen und Gewichtung", "Vermieter anschreiben"],
      intro: "Flat Hunt behält die Wohnungen im Blick, die du mieten oder kaufen möchtest: Kosten, Fläche, Wegzeiten zu den Orten, die dir wichtig sind, Warnzeichen und deine Gespräche mit Vermietern, sortiert nach dem, was dir wichtig ist. Alles hier lässt sich später in den Einstellungen ändern.",
      name: "Name dieser Suche", languages: "Sprachen auf der Seite", needLang: "Bitte mindestens eine Sprache ankreuzen.",
      netIncome: "Netto-Haushaltseinkommen pro Monat (€)", netIncomeHint: "Lass 0 stehen, wenn du es nicht angeben möchtest; die Bezahlbarkeit wird dann nicht geprüft.",
      affordShare: "Anteil des Einkommens fürs Wohnen", affordHint: "Wie viel vom Nettoeinkommen Miete oder Kreditrate ausmachen dürfen. Etwa ein Drittel ist eine gängige Faustregel; Angebote darüber werden als knapp oder zu teuer markiert.",
      modesQ: "Was suchst du?", rent: "Wohnung mieten", buy: "Wohnung kaufen", needMode: "Bitte Mieten, Kaufen oder beides ankreuzen.",
      maxWarm: "Max. Warmmiete (€ pro Monat)", maxCold: "Max. Kaltmiete (€ pro Monat, optional)", maxDeposit: "Max. Kaution (€, optional)", maxTakeover: "Max. Ablöse (€, optional)",
      maxPrice: "Max. Kaufpreis (€)", equity: "Eigenkapital (€)", apr: "Zins (% pro Jahr)", years: "Laufzeit (Jahre)", state: "Bundesland (Grunderwerbsteuer)", agentFeePct: "Maklerprovision (%)",
      taxHint: m => `Grunderwerbsteuersätze mit Stand ${m}; bitte den aktuellen Satz deines Bundeslands prüfen.`,
      roomsMin: "Zimmer mindestens", roomsMax: "Zimmer höchstens (optional)", sizeMin: "Fläche mindestens (m²)", sizeMax: "Fläche höchstens (m², optional)", floorMin: "Etage ab (optional)", floorMax: "Etage bis (optional)", floorHint: "-1 = Souterrain, 0 = Erdgeschoss.", needsLift: "Ich brauche einen Aufzug",
      outdoor: "Außenbereich", outdoorOpt: { any: "Egal", balcony: "Balkon oder Garten", garden: "Garten" },
      kitchen: "Einbauküche", kitchenOpt: { any: "Egal", required: "Muss vorhanden sein" },
      pets: "Ich habe Haustiere (nur Wohnungen mit Tierhaltung)", moveInFrom: "Einzug ab (optional)", moveInTo: "Einzug spätestens (optional)",
      wbs: "Wohnberechtigungsschein (WBS)", wbsOpt: { none: "Ich habe keinen WBS", have: "Ich habe einen WBS (WBS-Wohnungen willkommen)", exclude: "WBS-Wohnungen ausblenden" },
      placesH: "Wichtige Orte", placesHint: "Bis zu fünf Orte wie Arbeit, Schule oder Familie, jeweils mit dem längsten Weg, den du akzeptierst. Ein Angebot muss jede Grenze einhalten.",
      place: "Ort", placeName: "Name", placePh: "z. B. Arbeit", address: "Adresse", find: "Suchen", found: "Gefunden:", notFound: "Adresse nicht gefunden",
      travel: "Unterwegs mit", modes: { car: "Auto", transit: "Bus und Bahn", bike: "Fahrrad" }, maxMin: "Längster Weg (Min.)", time: "Ankunft bis (werktags)",
      addPlace: "Ort hinzufügen", remove: "Entfernen", noPlaces: "Noch keine Orte. Ohne Orte werden keine Wegzeiten geprüft.",
      radiusH: "Umkreis (optional)", radiusHint: "Nur Wohnungen in diesem Abstand um einen Mittelpunkt. Beides leer lassen für keinen Umkreis.", radiusCenter: "Adresse des Mittelpunkts", radiusKm: "Umkreis (km)",
      radiusBoth: "Für den Umkreis eine Mittelpunkt-Adresse suchen und die km eintragen, oder beides leer lassen.",
      needPlaceName: n => `Bitte Ort ${n} einen Namen geben.`, needFind: x => `Bitte für die Adresse von „${x}“ auf Suchen drücken.`, needTime: x => `Bitte eine Uhrzeit für „${x}“ eintragen.`,
      redFlags: "Warne mich bei", redHint: "Angebote, deren Text passt, bekommen ein Warnzeichen. Fahr mit der Maus über einen Eintrag, um den Grund zu sehen.",
      custom: "Eigene hinzufügen (Name und Suchwörter, z. B. „Nur bar“ und „nur bar|cash only“)", customLabel: "Name", customMatch: "Suchwörter", customOn: "Warnen",
      badPattern: x => `Die Suchwörter für „${x}“ sind kein gültiges Muster.`,
      weights: "Wie stark jeder Teil in die Punkte eingeht", weightHint: "0 = diesen Teil nicht werten", weightsZero: "Bitte mindestens einem Teil ein Gewicht über 0 geben.",
      w: { price: "Preis", size: "Fläche", commute: "Wege", area: "Umgebung", condition: "Zustand", contact: "Vermieter / Kontakt" },
      outreach: "Die Claude-Routine darf vorgemerkte Vermieter in meinem Namen anschreiben", paused: "Vorerst pausiert", outLang: "Sprache der Nachrichten",
      outreachHint: "Die Website verschickt selbst nie Nachrichten. Deine Claude-Routine verschickt nur Vorlagen, die du unten freigegeben hast, höchstens so viele pro Tag wie eingestellt, mit dem Mindestabstand zwischen zwei Nachrichten, nie zweimal an dieselbe Anzeige und nie Unterlagen. Der Pausenschalter oben auf der Seite stoppt sie sofort.",
      minGapMin: "Mindestabstand zwischen zwei Nachrichten (Minuten)", dailyCap: "Höchstens so viele Nachrichten pro Tag",
      templatesLater: "Die Nachrichtenvorlagen bearbeitest du in den Einstellungen und gibst sie dort frei, sobald die Suche eingerichtet ist; vorher wird nichts verschickt.", templatesSaveAtOnce: "Die Knöpfe der Vorlagen speichern sofort; „Speichern“ unten speichert die übrigen Einstellungen.", pausedTip: "Das änderst du mit dem Pausenschalter oben auf der Seite.",
      lang: { en: "English", de: "Deutsch", pt: "Português" },
      needNumber: "Bitte eine gültige Zahl eingeben für:", netFail: "Server nicht erreichbar:", loadFail: "Die Liste der Warnzeichen konnte nicht geladen werden; Speichern geht trotzdem.",
      notBelow: (a, b) => `„${a}“ darf nicht unter „${b}“ liegen.`,
      addListing: "Angebot hinzufügen", editListing: "Angebot bearbeiten", saveChanges: "Änderungen speichern", url: "Link zum Inserat", urlHint: "Ein https://-Link", title: "Titel",
      lmode: "Angebot", lmodes: { rent: "Zur Miete", buy: "Zum Kauf" }, postcode: "PLZ", city: "Ort",
      coldRent: "Kaltmiete (€ pro Monat)", utilities: "Nebenkosten (€ pro Monat)", warmRent: "Warmmiete (€ pro Monat)", deposit: "Kaution (€)", takeover: "Ablöse (€)", price: "Kaufpreis (€)",
      rooms: "Zimmer", size: "Fläche (m²)", floor: "Etage", lift: "Aufzug", loutdoor: "Außenbereich", loutdoorOpt: { none: "Keiner", balcony: "Balkon", garden: "Garten", both: "Balkon und Garten" },
      lkitchen: "Einbauküche", petsAllowed: "Haustiere erlaubt", availableFrom: "Frei ab", wbsRequired: "WBS erforderlich",
      contactName: "Ansprechpartner", contactType: "Anbieter", contactTypes: { private: "Privatvermieter", agent: "Makler", company: "Wohnungsgesellschaft" }, notes: "Notizen",
      unknown: "–", yes: "Ja", no: "Nein",
      needWhere: "Bitte eine Adresse oder PLZ und Ort eingeben.", needRent: "Bitte Kalt- oder Warmmiete eingeben.", needPrice: "Bitte den Kaufpreis eingeben."
    },
    pt: {
      wizard: "Configure sua busca de apartamento", settings: "Configurações", next: "Próximo", back: "Voltar", save: "Salvar", cancel: "Cancelar", finish: "Começar",
      steps: ["Boas-vindas e renda", "Alugar ou comprar", "O apartamento", "Onde", "Sinais de alerta e pesos", "Contato com proprietários"],
      intro: "O Flat Hunt acompanha os apartamentos que você considera alugar ou comprar: custos, área, tempos de trajeto até os locais que importam para você, sinais de alerta e suas conversas com proprietários, em ordem do que importa para você. Tudo o que você definir aqui pode ser alterado depois nas Configurações.",
      name: "Nome desta busca", languages: "Idiomas da página", needLang: "Marque pelo menos um idioma.",
      netIncome: "Renda líquida do domicílio por mês (€)", netIncomeHint: "Deixe 0 se preferir não informar; a verificação de capacidade de pagamento fica desativada.",
      affordShare: "Parte da renda para moradia", affordHint: "Quanto da renda líquida o aluguel ou a parcela do financiamento pode ocupar. Cerca de um terço é uma regra comum; anúncios acima disso são marcados como apertados ou caros demais.",
      modesQ: "O que você procura?", rent: "Alugar um apartamento", buy: "Comprar um apartamento", needMode: "Marque alugar, comprar ou ambos.",
      maxWarm: "Aluguel total máx. (€ por mês)", maxCold: "Aluguel sem despesas máx. (€ por mês, opcional)", maxDeposit: "Caução máx. (€, opcional)", maxTakeover: "Taxa de repasse máx. (€, opcional)",
      maxPrice: "Preço de compra máx. (€)", equity: "Capital próprio (€)", apr: "Juros (% ao ano)", years: "Prazo do financiamento (anos)", state: "Estado (imposto de transmissão)", agentFeePct: "Comissão do corretor (%)",
      taxHint: m => `Alíquotas do imposto de transmissão conferidas em ${m}; confirme a alíquota atual do seu estado.`,
      roomsMin: "Cômodos no mínimo", roomsMax: "Cômodos no máximo (opcional)", sizeMin: "Área mínima (m²)", sizeMax: "Área máxima (m², opcional)", floorMin: "Andar a partir de (opcional)", floorMax: "Andar até (opcional)", floorHint: "-1 = subsolo, 0 = térreo.", needsLift: "Preciso de elevador",
      outdoor: "Área externa", outdoorOpt: { any: "Tanto faz", balcony: "Varanda ou jardim", garden: "Jardim" },
      kitchen: "Cozinha equipada", kitchenOpt: { any: "Tanto faz", required: "Obrigatória" },
      pets: "Tenho animais (só apartamentos que aceitam animais)", moveInFrom: "Mudança a partir de (opcional)", moveInTo: "Mudança até (opcional)",
      wbs: "Autorização de moradia social (WBS)", wbsOpt: { none: "Não tenho WBS", have: "Tenho WBS (apartamentos WBS são bem-vindos)", exclude: "Ocultar apartamentos só com WBS" },
      placesH: "Locais importantes", placesHint: "Até cinco locais, como trabalho, escola ou família, cada um com o trajeto mais longo que você aceita. Um anúncio precisa cumprir todos os limites.",
      place: "Local", placeName: "Nome", placePh: "ex.: Trabalho", address: "Endereço", find: "Buscar", found: "Encontrado:", notFound: "Endereço não encontrado",
      travel: "Ir de", modes: { car: "Carro", transit: "Transporte público", bike: "Bicicleta" }, maxMin: "Trajeto máximo (min)", time: "Chegar até (dias úteis)",
      addPlace: "Adicionar local", remove: "Remover", noPlaces: "Nenhum local ainda. Sem locais, os tempos de trajeto não são verificados.",
      radiusH: "Raio (opcional)", radiusHint: "Só apartamentos até esta distância de um ponto central. Deixe os dois vazios para não usar raio.", radiusCenter: "Endereço do centro", radiusKm: "Raio (km)",
      radiusBoth: "Para o raio, busque um endereço central e informe os km, ou deixe os dois vazios.",
      needPlaceName: n => `Dê um nome ao local ${n}.`, needFind: x => `Clique em Buscar para o endereço de “${x}”.`, needTime: x => `Informe um horário para “${x}”.`,
      redFlags: "Avise-me sobre", redHint: "Anúncios cujo texto corresponde recebem um sinal de alerta. Passe o mouse sobre um item para ver o motivo.",
      custom: "Adicionar o seu (nome e palavras, ex.: “Só dinheiro” e “só dinheiro|nur bar”)", customLabel: "Nome", customMatch: "Palavras", customOn: "Avisar",
      badPattern: x => `As palavras de “${x}” não formam um padrão válido.`,
      weights: "Quanto cada parte conta na pontuação", weightHint: "0 = ignorar esta parte", weightsZero: "Dê a pelo menos uma parte um peso acima de 0.",
      w: { price: "Preço", size: "Área", commute: "Trajeto", area: "Região", condition: "Estado", contact: "Proprietário / contato" },
      outreach: "Permitir que a rotina do Claude contate em meu nome os proprietários salvos", paused: "Pausado por enquanto", outLang: "Idioma das mensagens",
      outreachHint: "O site nunca envia mensagens sozinho. Sua rotina do Claude envia só modelos que você aprovou abaixo, no máximo a quantidade por dia definida, com o intervalo mínimo entre mensagens, nunca duas vezes para o mesmo anúncio e nunca documentos. O botão de pausa no topo da página a interrompe na hora.",
      minGapMin: "Intervalo mínimo entre duas mensagens (minutos)", dailyCap: "Mensagens por dia, no máximo",
      templatesLater: "Você edita e aprova os modelos de mensagem nas Configurações depois de configurar a busca; antes disso nada é enviado.", templatesSaveAtOnce: "Os botões dos modelos salvam na hora; “Salvar” abaixo guarda as demais configurações.", pausedTip: "Mude isso com o botão de pausa no topo da página.",
      lang: { en: "English", de: "Deutsch", pt: "Português" },
      needNumber: "Informe um número válido para:", netFail: "Não foi possível falar com o servidor:", loadFail: "Não foi possível carregar a lista de sinais de alerta; ainda dá para salvar.",
      notBelow: (a, b) => `“${a}” não pode ficar abaixo de “${b}”.`,
      addListing: "Adicionar anúncio", editListing: "Editar anúncio", saveChanges: "Salvar alterações", url: "Link do anúncio", urlHint: "Um link https://", title: "Título",
      lmode: "Oferta", lmodes: { rent: "Para alugar", buy: "Para comprar" }, postcode: "CEP", city: "Cidade",
      coldRent: "Aluguel sem despesas (€ por mês)", utilities: "Despesas (€ por mês)", warmRent: "Aluguel total (€ por mês)", deposit: "Caução (€)", takeover: "Taxa de repasse (€)", price: "Preço de compra (€)",
      rooms: "Cômodos", size: "Área (m²)", floor: "Andar", lift: "Elevador", loutdoor: "Área externa", loutdoorOpt: { none: "Nenhuma", balcony: "Varanda", garden: "Jardim", both: "Varanda e jardim" },
      lkitchen: "Cozinha equipada", petsAllowed: "Aceita animais", availableFrom: "Disponível a partir de", wbsRequired: "Exige WBS",
      contactName: "Nome do contato", contactType: "Tipo de contato", contactTypes: { private: "Proprietário particular", agent: "Corretor", company: "Empresa de habitação" }, notes: "Anotações",
      unknown: "–", yes: "Sim", no: "Não",
      needWhere: "Informe um endereço, ou CEP e cidade.", needRent: "Informe o aluguel sem despesas ou o total.", needPrice: "Informe o preço de compra."
    }
  };
  const STATE_NAMES = {
    en: { BW: "Baden-Württemberg", BY: "Bavaria", BE: "Berlin", BB: "Brandenburg", HB: "Bremen", HH: "Hamburg", HE: "Hesse", MV: "Mecklenburg-Western Pomerania", NI: "Lower Saxony", NW: "North Rhine-Westphalia", RP: "Rhineland-Palatinate", SL: "Saarland", SN: "Saxony", ST: "Saxony-Anhalt", SH: "Schleswig-Holstein", TH: "Thuringia" },
    de: { BW: "Baden-Württemberg", BY: "Bayern", BE: "Berlin", BB: "Brandenburg", HB: "Bremen", HH: "Hamburg", HE: "Hessen", MV: "Mecklenburg-Vorpommern", NI: "Niedersachsen", NW: "Nordrhein-Westfalen", RP: "Rheinland-Pfalz", SL: "Saarland", SN: "Sachsen", ST: "Sachsen-Anhalt", SH: "Schleswig-Holstein", TH: "Thüringen" },
    pt: { BW: "Baden-Württemberg", BY: "Baviera", BE: "Berlim", BB: "Brandemburgo", HB: "Bremen", HH: "Hamburgo", HE: "Hesse", MV: "Meclemburgo-Pomerânia Ocidental", NI: "Baixa Saxônia", NW: "Renânia do Norte-Vestfália", RP: "Renânia-Palatinado", SL: "Sarre", SN: "Saxônia", ST: "Saxônia-Anhalt", SH: "Schleswig-Holstein", TH: "Turíngia" }
  };

  // Must stay equal to lib/profile.js defaultProfile(); test/setup.test.js compares them.
  function defaultProfile() {
    return {
      version: 1, name: "Flat Hunt", languages: ["en", "de", "pt"],
      modes: { rent: true, buy: false },
      money: { netIncome: 0, affordShare: 0.33 },
      rent: { maxWarm: 1200, maxCold: null, maxDeposit: null, maxTakeover: null },
      buy: { maxPrice: 350000, equity: 70000, apr: 3.8, years: 25, state: "NW", agentFeePct: 3.57 },
      flat: { roomsMin: 2, roomsMax: null, sizeMin: 50, sizeMax: null, floorMin: null, floorMax: null, needsLift: false, outdoor: "any", kitchen: "any", pets: false, moveInFrom: null, moveInTo: null, wbs: "none" },
      places: [], radius: { center: null, km: null },
      redFlags: [],
      weights: { price: 2, size: 1.5, commute: 2, area: 1, condition: 1, contact: 1 },
      outreach: { enabled: false, paused: false, language: "de", minGapMin: 20, dailyCap: 10 }
    };
  }
  if (typeof window === "undefined") { module.exports = { defaultProfile }; return; }

  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "text") e.textContent = v; else if (k.startsWith("on")) e[k] = v; else if (v === true) e.setAttribute(k, ""); else if (v !== false && v != null) e.setAttribute(k, v); } kids.flat().forEach(k => k && e.append(k)); return e; };
  const get = (o, path) => path.split(".").reduce((x, k) => x && x[k], o);
  const set = (o, path, v) => { const ks = path.split("."); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; };
  const fmtNum = (v, digits = 1) => new Intl.NumberFormat(document.documentElement.lang || "en", { maximumFractionDigits: digits }).format(Number(v));
  const option = (value, label, selected) => { const o = el("option", { value, text: label }); o.selected = selected; return o; };
  let uid = 0; const nextId = () => "sx-" + (++uid);

  // Field builders return [element, read(), input?, sync?]. read() writes the value into the profile and returns
  // a label string for a number field that is empty or out of range, or { err } for any other problem.
  function text(t, p, path, label) { const i = el("input", { type: "text", value: get(p, path) ?? "", maxlength: 80 }); return [el("label", {}, t[label] || label, i), () => set(p, path, i.value.trim()), i]; }
  function number(t, p, path, label, opts = {}) {
    const { min, max } = opts;
    const i = el("input", { type: "number", value: get(p, path) ?? "", min, max, step: opts.step || 1, required: !opts.nullable, inputmode: opts.step && opts.step % 1 ? "decimal" : "numeric" });
    return [el("label", {}, t[label] || label, i), () => {
      const raw = i.value.trim();
      if (raw === "" && opts.nullable) { set(p, path, null); return; }
      const n = Number(raw);
      const ok = raw !== "" && Number.isFinite(n) && (min == null || n >= min) && (max == null || n <= max) && (!opts.whole || Number.isInteger(n)) && (!opts.half || (n * 2) % 1 === 0);
      if (!ok) return `${t[label] || label} (${fmtNum(min)}–${fmtNum(max)})`; // profile left unchanged
      set(p, path, n);
    }, i];
  }
  function dateField(t, p, path, label) { const i = el("input", { type: "date", value: get(p, path) ?? "" }); return [el("label", {}, t[label], i), () => set(p, path, i.value || null), i]; }
  function check(t, p, path, label) { const i = el("input", { type: "checkbox" }); i.checked = !!get(p, path); return [el("div", { class: "opts" }, el("label", {}, i, t[label] || label)), () => set(p, path, i.checked), i]; }
  function multi(t, p, path, label, options, names, emptyMsg) {
    const cur = new Set(get(p, path)); const boxes = options.map(o => { const b = el("input", { type: "checkbox", value: o }); b.checked = cur.has(o); return b; });
    return [el("fieldset", {}, el("legend", { text: t[label] || label }), el("div", { class: "opts" }, boxes.map((b, i) => el("label", {}, b, names[options[i]])))), () => {
      const v = boxes.filter(b => b.checked).map(b => b.value);
      if (!v.length && emptyMsg) return { err: emptyMsg };
      set(p, path, v);
    }];
  }
  function select(t, p, path, label, options, names) {
    const s = el("select", {}, options.map(o => option(o, names[o], get(p, path) === o)));
    return [el("label", {}, t[label] || label, s), () => set(p, path, s.value), s];
  }
  const hint = s => [el("p", { class: "hint", text: s }), () => {}];
  // Short fields side by side; wraps to one column on narrow screens.
  function group(...fields) { return [el("div", { class: "frow" }, fields.map(f => f[0])), () => fields.map(f => f[1]())]; }
  // A checkbox that shows its dependent fields only while it is ticked. Hidden fields are not read, so their values stay in the profile.
  function reveal(ctrl, fields, onOpen) {
    const box = el("div", { class: "sub" }, fields.map(f => f[0]));
    const sync = () => { box.hidden = !ctrl[2].checked; if (ctrl[2].checked && onOpen) onOpen(); };
    ctrl[2].addEventListener("change", sync); sync();
    return [el("div", { class: "grp" }, ctrl[0], box), () => [ctrl[1](), ...(box.hidden ? [] : fields.map(f => f[1]()))], null, () => sync()];
  }
  // A check that runs after the fields before it were read.
  const rule = fn => [null, fn];

  function affordField(t, p) {
    const i = el("input", { type: "range", min: 20, max: 50, step: 1, value: Math.round(p.money.affordShare * 100) });
    const out = el("output", { class: "wv", text: fmtNum(i.value, 0) + " %" });
    i.addEventListener("input", () => { out.textContent = fmtNum(i.value, 0) + " %"; });
    return [el("label", { class: "weight" }, el("span", { class: "wl" }, el("span", { text: t.affordShare }), out), i, el("span", { class: "hint", text: t.affordHint })), () => { p.money.affordShare = Number(i.value) / 100; }];
  }

  function stateField(t, p, lang) {
    const rates = (window.Money && Money.TRANSFER_TAX) || {}, names = STATE_NAMES[lang] || STATE_NAMES.en;
    const s = el("select", {}, STATES.map(c => option(c, rates[c] != null ? `${names[c]} (${fmtNum(rates[c])} %)` : names[c], p.buy.state === c)));
    const checked = window.Money && Money.TRANSFER_TAX_CHECKED;
    const month = checked && new Date(checked + "-01T12:00:00Z").toLocaleDateString(lang, { month: "long", year: "numeric", timeZone: "UTC" });
    return [el("label", {}, t.state, s, month ? el("span", { class: "hint", text: t.taxHint(month) }) : null), () => { p.buy.state = s.value; }];
  }

  // Address input with a Find button. The typed text is kept as the address; the geocoder's long name is only shown as confirmation.
  // get() returns { address, lat, lon } after a successful Find, or null once the text changes.
  function geoInput(t, init) {
    const id = nextId();
    const i = el("input", { type: "text", id, value: init ? init.address : "", autocomplete: "street-address", maxlength: 200 });
    const out = el("p", { class: "hint", "aria-live": "polite" });
    let last = init || null, cur = init || null;
    const b = el("button", { type: "button", class: "primary", text: t.find });
    const find = async () => {
      const q = i.value.trim().slice(0, 200); if (!q) { i.focus(); return; }
      out.textContent = "…"; b.disabled = true;
      try {
        const r = await fetch("/api/geocode?q=" + encodeURIComponent(q));
        if (!r.ok) throw new Error(String(r.status));
        const g = await r.json();
        cur = last = { address: q, lat: g.lat, lon: g.lon }; out.textContent = `${t.found} ${g.label}`;
      } catch (e) { out.textContent = t.notFound; }
      finally { b.disabled = false; }
    };
    b.onclick = find;
    // Enter looks the address up instead of moving on.
    i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); find(); } });
    i.addEventListener("input", () => { cur = last && i.value.trim() === last.address ? last : null; if (!cur) out.textContent = ""; });
    return { id, box: el("div", { class: "addr" }, i, b), out, get: () => cur, text: () => i.value.trim() };
  }

  function placesField(t, p) {
    const rows = [];
    const host = el("div", { class: "places" });
    const empty = el("p", { class: "hint", text: t.noPlaces });
    const add = el("button", { type: "button", text: t.addPlace });
    const sync = () => { add.disabled = rows.length >= MAX_PLACES; empty.hidden = rows.length > 0; host.hidden = !rows.length; rows.forEach((r, n) => { r.head.textContent = `${t.place} ${n + 1}`; }); };
    const addRow = pl => {
      const r = { head: el("strong") };
      r.label = el("input", { type: "text", value: pl ? pl.label : "", maxlength: 200, placeholder: t.placePh });
      r.geo = geoInput(t, pl ? { address: pl.address, lat: pl.lat, lon: pl.lon } : null);
      r.mode = el("select", {}, PLACE_MODES.map(m => option(m, t.modes[m], (pl ? pl.mode : "transit") === m)));
      r.maxMin = el("input", { type: "number", min: 5, max: 180, step: 5, value: pl ? pl.maxMin : 30, inputmode: "numeric", required: true });
      r.time = el("input", { type: "time", value: pl ? pl.time : "08:00", required: true });
      const rm = el("button", { type: "button", text: t.remove, onclick: () => { rows.splice(rows.indexOf(r), 1); r.box.remove(); sync(); add.focus(); } });
      r.box = el("div", { class: "place" },
        el("div", { class: "bar" }, r.head, el("span"), rm),
        el("label", {}, t.placeName, r.label),
        el("div", { class: "fld" }, el("label", { for: r.geo.id }, t.address), r.geo.box, r.geo.out),
        el("div", { class: "frow" }, el("label", {}, t.travel, r.mode), el("label", {}, t.maxMin, r.maxMin), el("label", {}, t.time, r.time)));
      rows.push(r); host.append(r.box); sync();
      return r;
    };
    add.onclick = () => { if (rows.length < MAX_PLACES) addRow().label.focus(); };
    (p.places || []).forEach(addRow); sync();
    const read = () => {
      const errs = [];
      const out = rows.map((r, n) => {
        const label = r.label.value.trim(), name = label || `${t.place} ${n + 1}`, g = r.geo.get(), mm = Number(r.maxMin.value);
        if (!label) errs.push({ err: t.needPlaceName(n + 1) });
        if (!g) errs.push({ err: t.needFind(name) });
        if (r.maxMin.value.trim() === "" || !Number.isInteger(mm) || mm < 5 || mm > 180) errs.push(`${name}: ${t.maxMin} (5–180)`);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time.value)) errs.push({ err: t.needTime(name) });
        // Key order as stored, so an unchanged place compares equal on the server.
        return g && { label, address: g.address, lat: g.lat, lon: g.lon, maxMin: mm, mode: r.mode.value, time: r.time.value };
      });
      if (!errs.length) p.places = out;
      return errs;
    };
    return [el("fieldset", {}, el("legend", { text: t.placesH }), el("p", { class: "hint", text: t.placesHint }), host, empty, el("div", {}, add)), read];
  }

  function radiusField(t, p) {
    const g = geoInput(t, p.radius.center);
    const km = el("input", { type: "number", min: 1, max: 100, step: "any", value: p.radius.km ?? "", inputmode: "decimal" });
    const read = () => {
      const txt = g.text(), raw = km.value.trim();
      if (!txt && !raw) { p.radius = { center: null, km: null }; return; }
      if (!txt || !raw) return { err: t.radiusBoth };
      if (!g.get()) return { err: t.needFind(t.radiusCenter) };
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1 || n > 100) return `${t.radiusKm} (1–100)`;
      const c = g.get();
      p.radius = { center: { address: c.address, lat: c.lat, lon: c.lon }, km: n };
    };
    return [el("fieldset", {}, el("legend", { text: t.radiusH }), el("p", { class: "hint", text: t.radiusHint }),
      el("div", { class: "fld" }, el("label", { for: g.id }, t.radiusCenter), g.box, g.out), el("label", {}, t.radiusKm, km)), read];
  }

  function redFlagsField(t, p, catalogue, lang) {
    const state = new Map((p.redFlags || []).map(a => [a.id, a]));
    const boxes = catalogue.map(d => { const b = el("input", { type: "checkbox", value: d.id }); b.checked = state.has(d.id) ? state.get(d.id).on : d.default; return [b, d]; });
    const customs = (p.redFlags || []).filter(a => a.id.startsWith("custom-"));
    // Entries the catalogue does not list (e.g. it failed to load) are kept as they are.
    const known = new Set(catalogue.map(d => d.id));
    const kept = (p.redFlags || []).filter(a => !a.id.startsWith("custom-") && !known.has(a.id));
    const rows = el("div", { style: "display:grid;gap:8px" }); const custom = [];
    const addRow = (a = { label: "", match: "", on: true }) => {
      const c = el("input", { type: "checkbox" }); c.checked = a.on !== false;
      const n = el("input", { type: "text", value: a.label, placeholder: t.customLabel, maxlength: 80 }); const m = el("input", { type: "text", value: a.match, placeholder: t.customMatch, maxlength: 200 });
      // A new empty row appears once the last one is filled in.
      const grow = () => { if (custom[custom.length - 1] === row && (n.value.trim() || m.value.trim())) addRow(); };
      n.addEventListener("input", grow); m.addEventListener("input", grow);
      const row = [c, n, m]; custom.push(row); rows.append(el("div", { class: "frow" }, el("div", { class: "opts" }, el("label", {}, c, t.customOn)), n, m));
    };
    customs.forEach(addRow); addRow();
    const read = () => {
      const out = boxes.map(([b, d]) => ({ id: d.id, on: b.checked })).concat(kept), errs = [];
      let k = 1;
      for (const [c, n, m] of custom) {
        const label = n.value.trim(), match = m.value.trim();
        if (!label || !match) continue;
        try { new RegExp(match, "i"); } catch (e) { errs.push({ err: t.badPattern(label) }); continue; }
        out.push({ id: `custom-${k++}`, on: c.checked, label, match });
      }
      if (!errs.length) p.redFlags = out;
      return errs;
    };
    return [el("fieldset", {}, el("legend", { text: t.redFlags }), el("p", { class: "hint", text: t.redHint }),
      el("div", { class: "opts" }, boxes.map(([b, d]) => el("label", { title: (d.reason && (d.reason[lang] || d.reason.en)) || "" }, b, d.label[lang] || d.label.en))),
      el("p", { class: "hint", text: t.custom }), rows), read];
  }

  function weightsField(t, p) {
    const inputs = Object.fromEntries(WEIGHT_KEYS.map(k => [k, el("input", { type: "range", min: 0, max: 5, step: 0.5, value: p.weights[k] })]));
    const labels = Object.entries(inputs).map(([k, i]) => {
      const out = el("output", { class: "wv", text: fmtNum(i.value) });
      i.addEventListener("input", () => { out.textContent = fmtNum(i.value); });
      return el("label", { class: "weight" }, el("span", { class: "wl" }, el("span", { text: t.w[k] }), out), i);
    });
    return [el("fieldset", {}, el("legend", { text: t.weights }), el("p", { class: "hint", text: t.weightHint }), el("div", { class: "frow" }, labels)), () => {
      const w = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, Number(i.value)]));
      if (!WEIGHT_KEYS.some(k => w[k] > 0)) return { err: t.weightsZero };
      p.weights = w;
    }];
  }

  // The pause state is owned by the switch in the page header (PUT /api/outreach/pause); here it is shown, not edited.
  function pausedField(t, p) {
    const i = el("input", { type: "checkbox", disabled: true }); i.checked = !!p.outreach.paused;
    return [el("div", { class: "opts" }, el("label", { title: t.pausedTip }, i, t.paused)), () => {}];
  }
  // Wizard: a note only. Settings: the template editor, mounted once per opened dialog (the fourth element runs after every render).
  function templatesField(t, mode, lang) {
    if (mode !== "settings") return hint(t.templatesLater);
    const box = el("div", { class: "tpl" });
    let mounted = false;
    return [el("div", { class: "tplwrap" }, el("p", { class: "hint", text: t.templatesSaveAtOnce }), box), () => {}, null, () => {
      if (mounted || !window.OutreachUI) return;
      mounted = true; window.OutreachUI.mountTemplates(box, { lang });
    }];
  }

  function steps(t, p, catalogue, lang, mode) {
    const notBelow = (hi, lo, a, b) => p.flat[hi] != null && p.flat[lo] != null && p.flat[hi] < p.flat[lo] ? { err: t.notBelow(t[a], t[b]) } : null;
    return [
      [text(t, p, "name", "name"), multi(t, p, "languages", "languages", LANGS, t.lang, t.needLang),
        number(t, p, "money.netIncome", "netIncome", { min: 0, max: 100000, step: 50 }), hint(t.netIncomeHint), affordField(t, p)],
      [[el("p", { class: "hint", text: t.modesQ }), () => {}],
        reveal(check(t, p, "modes.rent", "rent"), [group(number(t, p, "rent.maxWarm", "maxWarm", { min: 0, max: 20000, step: 10 }), number(t, p, "rent.maxCold", "maxCold", { min: 0, max: 20000, step: 10, nullable: true })),
          group(number(t, p, "rent.maxDeposit", "maxDeposit", { min: 0, max: 100000, step: 100, nullable: true }), number(t, p, "rent.maxTakeover", "maxTakeover", { min: 0, max: 100000, step: 100, nullable: true }))]),
        reveal(check(t, p, "modes.buy", "buy"), [group(number(t, p, "buy.maxPrice", "maxPrice", { min: 0, max: 10000000, step: 5000 }), number(t, p, "buy.equity", "equity", { min: 0, max: 10000000, step: 1000 })),
          group(number(t, p, "buy.apr", "apr", { min: 0, max: 15, step: 0.01 }), number(t, p, "buy.years", "years", { min: 5, max: 40, whole: true }), number(t, p, "buy.agentFeePct", "agentFeePct", { min: 0, max: 7.14, step: 0.01 })),
          stateField(t, p, lang)]),
        rule(() => !p.modes.rent && !p.modes.buy ? { err: t.needMode } : null)],
      [group(number(t, p, "flat.roomsMin", "roomsMin", { min: 1, max: 10, step: 0.5, half: true }), number(t, p, "flat.roomsMax", "roomsMax", { min: 1, max: 10, step: 0.5, half: true, nullable: true })),
        group(number(t, p, "flat.sizeMin", "sizeMin", { min: 10, max: 500 }), number(t, p, "flat.sizeMax", "sizeMax", { min: 10, max: 500, nullable: true })),
        group(number(t, p, "flat.floorMin", "floorMin", { min: -1, max: 40, whole: true, nullable: true }), number(t, p, "flat.floorMax", "floorMax", { min: -1, max: 40, whole: true, nullable: true })), hint(t.floorHint),
        check(t, p, "flat.needsLift", "needsLift"),
        group(select(t, p, "flat.outdoor", "outdoor", ["any", "balcony", "garden"], t.outdoorOpt), select(t, p, "flat.kitchen", "kitchen", ["any", "required"], t.kitchenOpt)),
        check(t, p, "flat.pets", "pets"),
        group(dateField(t, p, "flat.moveInFrom", "moveInFrom"), dateField(t, p, "flat.moveInTo", "moveInTo")),
        select(t, p, "flat.wbs", "wbs", ["none", "have", "exclude"], t.wbsOpt),
        rule(() => [notBelow("roomsMax", "roomsMin", "roomsMax", "roomsMin"), notBelow("sizeMax", "sizeMin", "sizeMax", "sizeMin"), notBelow("floorMax", "floorMin", "floorMax", "floorMin"), notBelow("moveInTo", "moveInFrom", "moveInTo", "moveInFrom")])],
      [placesField(t, p), radiusField(t, p)],
      [redFlagsField(t, p, catalogue, lang), weightsField(t, p)],
      [reveal(check(t, p, "outreach.enabled", "outreach"), [
        pausedField(t, p),
        select(t, p, "outreach.language", "outLang", ["de", "en"], t.lang),
        group(number(t, p, "outreach.minGapMin", "minGapMin", { min: 5, max: 1440, whole: true }), number(t, p, "outreach.dailyCap", "dailyCap", { min: 1, max: 50, whole: true }))]),
        hint(t.outreachHint), templatesField(t, mode, lang)]
    ];
  }

  async function open({ mode, lang, onSaved }) {
    const t = L[lang] || L.en;
    let catalogue = [], loadFail = false;
    try { const r = await fetch("redflags.json"); if (!r.ok) throw new Error(String(r.status)); catalogue = await r.json(); if (!Array.isArray(catalogue)) throw new Error("bad list"); }
    catch (e) { catalogue = []; loadFail = true; }
    let p = mode === "settings" && window.FlatHunt ? structuredClone(window.FlatHunt.profile()) : defaultProfile();
    if (mode === "wizard") p.redFlags = catalogue.map(d => ({ id: d.id, on: d.default }));
    const all = steps(t, p, catalogue, lang, mode);
    const err = el("p", { class: "err", role: "alert" });
    const dlg = el("dialog", { class: "sx" + (mode === "wizard" ? " wiz" : "") });
    const form = el("form", { method: "dialog", novalidate: true });
    const intro = el("p", { class: "intro", text: t.intro });
    let at = 0, saved = false, busy = false;
    const show = () => {
      form.innerHTML = "";
      const sections = mode === "wizard" ? [at] : all.map((_, i) => i);
      const head = el("div", { class: "sxhead" }, el("h2", { text: mode === "wizard" ? t.wizard : t.settings }));
      // Stepper: every step by name, the current one highlighted, earlier ones marked done.
      if (mode === "wizard") head.append(el("ol", { class: "stepper" }, t.steps.map((name, i) => el("li", { class: i < at ? "done" : i === at ? "cur" : "", "aria-current": i === at ? "step" : null }, el("span", { class: "dot", text: i < at ? "✓" : String(i + 1) }), el("span", { class: "nm", text: name })))));
      const body = el("div", { class: "sxbody" });
      if (loadFail) body.append(el("p", { class: "err", text: t.loadFail }));
      sections.forEach(i => {
        if (mode === "wizard" && i === 0) body.append(intro);
        body.append(el("fieldset", {}, el("h3", { text: t.steps[i] }), all[i].map(([node]) => node)));
        all[i].forEach(f => typeof f[3] === "function" && f[3]());
      });
      const bar = el("div", { class: "bar" });
      if (mode === "wizard" && at > 0) bar.append(el("button", { type: "button", text: t.back, onclick: () => { readStep(at); err.textContent = ""; at--; show(); } }));
      if (mode === "settings") bar.append(el("button", { type: "button", text: t.cancel, onclick: () => dlg.close() }));
      bar.append(el("span"));
      if (mode === "wizard" && at < all.length - 1) bar.append(el("button", { type: "button", class: "primary", text: t.next, onclick: next }));
      else bar.append(el("button", { type: "button", class: "primary", text: mode === "wizard" ? t.finish : t.save, onclick: submit }));
      form.append(head, body, el("div", { class: "sxfoot" }, err, bar));
      body.scrollTop = 0;
    };
    // readStep returns the problems found: label strings for bad numbers, { err } objects for everything else.
    const readStep = i => all[i].map(([, read]) => read()).flat(Infinity).filter(Boolean);
    const problems = list => {
      if (!list.length) return false;
      const nums = list.filter(x => typeof x === "string"), other = list.filter(x => typeof x === "object").map(x => x.err);
      err.textContent = [...(nums.length ? [`${t.needNumber} ${nums.join(", ")}`] : []), ...other].join("\n");
      return true;
    };
    function next() {
      if (problems(readStep(at))) return;
      err.textContent = ""; at++; show();
    }
    async function submit() {
      if (busy) return;
      if (mode === "wizard" ? problems(readStep(at)) : problems(all.flatMap((_, i) => readStep(i)))) return;
      let r; const btn = form.querySelector(".bar .primary"); busy = true; if (btn) btn.disabled = true;
      try { r = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }); }
      catch (e) { err.textContent = `${t.netFail} ${e.message}`; return; }
      finally { busy = false; if (btn) btn.disabled = false; }
      if (!r.ok) { const j = await r.json().catch(() => ({})); err.textContent = (j.details || [j.error || String(r.status)]).join("\n"); return; }
      saved = true; dlg.close(); document.body.classList.remove("setup"); onSaved && onSaved();
    }
    // Enter never closes the form natively: in a field it acts as Next, or as Save/Start on the last step.
    const enter = () => { if (mode === "wizard" && at < all.length - 1) next(); else submit(); };
    form.addEventListener("submit", e => { e.preventDefault(); enter(); });
    form.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing && e.target.matches("input:not([type=checkbox]):not([type=radio]), select")) { e.preventDefault(); enter(); } });
    dlg.append(form); document.body.append(dlg);
    // The wizard cannot be dismissed before a profile is saved.
    dlg.addEventListener("close", () => { if (mode === "wizard" && !saved) dlg.showModal(); else dlg.remove(); });
    if (mode === "wizard") {
      dlg.addEventListener("cancel", e => e.preventDefault());
      dlg.addEventListener("keydown", e => { if (e.key === "Escape") e.preventDefault(); });
    }
    show(); dlg.showModal();
  }

  // The add and edit dialogs share this form. listing prefills it and switches it to editing: only changed fields
  // are sent, a cleared optional field is sent as null, and notes stay on the listing card where they are edited.
  function listingDialog({ lang, listing, onSaved }) {
    const t = L[lang] || L.en, editing = !!listing;
    const yn = () => el("select", {}, option("", t.unknown), option("yes", t.yes), option("no", t.no));
    const choice = (values, names) => el("select", {}, option("", t.unknown), values.map(v => option(v, names[v])));
    const money = () => el("input", { type: "number", min: 0, step: "any", inputmode: "decimal" });
    const f = {
      url: el("input", { type: "url", required: true, pattern: "https://.+", maxlength: 500, title: t.urlHint, placeholder: "https://" }),
      title: el("input", { type: "text", required: true, maxlength: 200 }),
      mode: el("select", {}, ["rent", "buy"].map(m => option(m, t.lmodes[m]))),
      address: el("input", { type: "text", maxlength: 200, autocomplete: "off" }),
      postcode: el("input", { type: "text", pattern: "\\d{5}", maxlength: 5, inputmode: "numeric" }),
      city: el("input", { type: "text", maxlength: 120 }),
      coldRent: money(), utilities: money(), warmRent: money(), deposit: money(), takeover: money(), price: money(),
      rooms: el("input", { type: "number", min: 1, max: 20, step: 0.5, required: true, inputmode: "decimal" }),
      size: el("input", { type: "number", min: 5, max: 2000, step: "any", required: true, inputmode: "decimal" }),
      floor: el("input", { type: "number", min: -1, max: 100, step: 1, inputmode: "numeric" }),
      lift: yn(), outdoor: choice(["none", "balcony", "garden", "both"], t.loutdoorOpt), kitchen: yn(), petsAllowed: yn(),
      availableFrom: el("input", { type: "date" }), wbsRequired: yn(),
      contactName: el("input", { type: "text", maxlength: 120 }), contactType: choice(["private", "agent", "company"], t.contactTypes),
      notes: el("textarea", { rows: 3, maxlength: 5000 })
    };
    const BOOLS = ["lift", "kitchen", "petsAllowed", "wbsRequired"], NUMS = ["coldRent", "utilities", "warmRent", "deposit", "takeover", "price", "rooms", "size", "floor"];
    // Form values in the shape the API takes; anything empty is null.
    const read = () => Object.fromEntries(Object.keys(f).filter(k => k !== "notes").map(k => {
      const v = f[k].value.trim();
      if (v === "") return [k, null];
      if (BOOLS.includes(k)) return [k, v === "yes"];
      if (NUMS.includes(k)) return [k, Number(v)];
      return [k, v];
    }));
    // Only the money fields of the chosen mode count; the other mode's values are left as they are.
    const relevant = vals => Object.fromEntries(Object.entries(vals).filter(([k]) => !(vals.mode === "rent" ? BUY_FIELDS : RENT_FIELDS).includes(k)));
    let before = null;
    if (editing) {
      const c = listing.contact || {};
      const v = { ...listing, contactName: c.name, contactType: c.type };
      for (const k of Object.keys(f)) {
        if (k === "notes") continue;
        const x = v[k];
        f[k].value = BOOLS.includes(k) ? (x === true ? "yes" : x === false ? "no" : "") : (x ?? "");
      }
      before = read();
    } else {
      const prof = window.FlatHunt && window.FlatHunt.profile();
      f.mode.value = prof && prof.modes && !prof.modes.rent && prof.modes.buy ? "buy" : "rent";
    }
    const lbl = (key, input) => el("label", {}, t[key], input);
    const rentBox = el("div", { class: "grp" }, el("div", { class: "frow" }, lbl("coldRent", f.coldRent), lbl("utilities", f.utilities), lbl("warmRent", f.warmRent)), el("div", { class: "frow" }, lbl("deposit", f.deposit), lbl("takeover", f.takeover)));
    const buyBox = el("div", { class: "frow" }, lbl("price", f.price));
    const syncMode = () => { rentBox.hidden = f.mode.value !== "rent"; buyBox.hidden = f.mode.value !== "buy"; };
    f.mode.addEventListener("change", syncMode); syncMode();
    const err = el("p", { class: "err", role: "alert" });
    const dlg = el("dialog", { class: "sx" });
    const form = el("form", { method: "dialog" },
      el("div", { class: "sxhead" }, el("h2", { text: editing ? t.editListing : t.addListing })),
      el("div", { class: "sxbody" }, lbl("url", f.url), lbl("title", f.title), el("div", { class: "frow" }, lbl("lmode", f.mode)),
        lbl("address", f.address), el("div", { class: "frow" }, lbl("postcode", f.postcode), lbl("city", f.city)),
        rentBox, buyBox,
        el("div", { class: "frow" }, lbl("rooms", f.rooms), lbl("size", f.size), lbl("floor", f.floor)),
        el("div", { class: "frow" }, lbl("lift", f.lift), lbl("loutdoor", f.outdoor), lbl("lkitchen", f.kitchen)),
        el("div", { class: "frow" }, lbl("petsAllowed", f.petsAllowed), lbl("availableFrom", f.availableFrom), lbl("wbsRequired", f.wbsRequired)),
        el("div", { class: "frow" }, lbl("contactName", f.contactName), lbl("contactType", f.contactType)),
        editing ? null : lbl("notes", f.notes)),
      el("div", { class: "sxfoot" }, err, el("div", { class: "bar" }, el("button", { type: "button", text: t.cancel, onclick: () => dlg.close() }), el("span"), el("button", { type: "submit", class: "primary", text: editing ? t.saveChanges : t.addListing }))));
    form.onsubmit = async e => {
      e.preventDefault();
      const now = relevant(read());
      const missing = [];
      if (now.address == null && (now.postcode == null || now.city == null)) missing.push(t.needWhere);
      if (now.mode === "rent" && now.coldRent == null && now.warmRent == null) missing.push(t.needRent);
      if (now.mode === "buy" && now.price == null) missing.push(t.needPrice);
      if (missing.length) { err.textContent = missing.join("\n"); return; }
      let body;
      if (editing) body = Object.fromEntries(Object.entries(now).filter(([k, v]) => v !== before[k]));
      else {
        body = Object.fromEntries(Object.entries(now).filter(([, v]) => v != null));
        if (f.notes.value.trim()) body.notes = f.notes.value.trim();
      }
      if (editing && !Object.keys(body).length) { dlg.close(); return; }
      const btn = form.querySelector(".bar .primary"); if (btn.disabled) return; btn.disabled = true;
      let r;
      const req = editing ? ["/api/listings/" + encodeURIComponent(listing.id) + "/listing", "PATCH"] : ["/api/listings", "POST"];
      try { r = await fetch(req[0], { method: req[1], headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
      catch (x) { err.textContent = `${t.netFail} ${x.message}`; return; }
      finally { btn.disabled = false; }
      if (!r.ok) { const j = await r.json().catch(() => ({})); err.textContent = (j.details || [j.error || String(r.status)]).join("\n"); return; }
      dlg.close(); onSaved && onSaved();
    };
    dlg.append(form); document.body.append(dlg); dlg.addEventListener("close", () => dlg.remove()); dlg.showModal();
  }
  const addListing = ({ lang, onSaved }) => listingDialog({ lang, onSaved });
  const editListing = ({ listing, lang, onSaved }) => listingDialog({ listing, lang, onSaved });

  window.Setup = { open, addListing, editListing };
})();
