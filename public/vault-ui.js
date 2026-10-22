// public/vault-ui.js — "About me" section (applicant profile, summary PDF, document vault) and the listing's Documents section.
(function () {
  // Same order as DOC_TYPES in lib/documents.js.
  const TYPES = ["payslip", "contract", "schufa", "id", "rent-confirmation", "landlord-reference", "other"];
  const MAX_BYTES = 10 * 1024 * 1024;
  const MIME_BY_EXT = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
  const KIND = { "application/pdf": "PDF", "image/jpeg": "JPEG", "image/png": "PNG" };
  const README_URL = "https://github.com/DasMehl/flat-hunt#run-your-own-copy";

  // Copy of defaultApplicant() in lib/applicant.js (test/vault-ui.test.js keeps them equal).
  function defaultApplicant() {
    return {
      name: "", email: "", phone: "",
      household: { adults: 1, children: 0, pets: "" },
      job: { title: "", employer: "", since: null, permanent: false },
      schufaAvailable: false, landlordReferenceAvailable: false,
      about: ""
    };
  }

  // Document type names: same wording as lib/share-public.js.
  const L = {
    en: {
      locale: "en-GB", title: "About me", loading: "Loading…",
      offTitle: "Documents are switched off",
      offWhat: "Your applicant profile and documents are stored encrypted with a key that only this server knows: the VAULT_KEY variable.",
      offHow: "Create one with the command below, set it as VAULT_KEY on the service and restart.",
      offKeep: "Keep a copy in your password manager: without the same key the stored documents cannot be read.",
      offMore: "Setup steps in the README", offWrong: "The server could not open the document vault with the key it has.",
      profile: "Applicant profile", profileIntro: "What landlords usually ask about you. It goes into the applicant summary.",
      name: "Name", email: "Email", phone: "Phone",
      household: "Household", adults: "Adults", children: "Children", pets: "Pets", petsPh: "e.g. one cat",
      job: "Work", jobTitle: "Job title", employer: "Employer", since: "Employed since", permanent: "Permanent contract",
      papers: "Available on request", schufa: "SCHUFA report available", landlordRef: "Landlord reference available",
      about: "About us", aboutPh: "A few sentences for the landlord: who you are, why this flat.",
      save: "Save profile", saved: "Saved", saveFail: "Could not save", netFail: "Could not reach the server.", fixThis: "Please check:",
      summary: "Applicant summary", summaryBtn: l => `Summary PDF (${l.toUpperCase()})`,
      summaryHint: "One page for landlords with your profile and the net income from Settings. Opens in a new tab.",
      summaryNeedSave: "Save the profile first to create the summary.",
      docs: "Documents", upload: "Add a document", file: "File (PDF, JPEG or PNG, up to 10 MB)", type: "Type", label: "Label", labelPh: "e.g. September salary",
      date: "Document date (e.g. pay month)", uploadBtn: "Upload", uploading: "Uploading…", uploaded: "Uploaded", needFile: "Please choose a file.",
      tooBig: "File is larger than 10 MB", onlyTypes: "Only PDF, JPEG or PNG", notReally: k => `The file is not really a ${k}`,
      badPdf: "This PDF is encrypted or damaged; print it to a new PDF and try again",
      empty: "No documents yet. Landlords usually ask for your last three payslips, a SCHUFA report, an ID, a rent payment confirmation and a landlord reference.",
      uploadedOn: d => `uploaded ${d}`, redacted: "Redacted", outdated: "Older than 3 months",
      outdatedTip: "Landlords usually ask for the last three payslips; this one is older.",
      download: "Download", edit: "Edit", redact: "Redact", del: "Delete", cancel: "Cancel", saveDoc: "Save",
      confirmDelete: n => `Delete “${n}”? The file is removed from the vault and cannot be restored.`,
      // Listing: Documents section
      reqNone: "No document requests logged yet.", logReq: "Log a request", reqWhich: "What did the landlord ask for?", reqSave: "Save request", needOne: "Tick at least one document.",
      approve: "Approve and create a link", approveIntro: "Tick what this landlord may see. Only these documents are behind the link.",
      summaryNeedApplicant: "Save your applicant profile under About me first.", noDocsYet: "No documents in the vault yet. Add them under About me.",
      days: "Link valid for (days, 1–30)", createLink: "Create link", creating: "Creating…",
      payTitle: "Payslip not redacted", payText: "Before you share a payslip, cover your tax ID, social-security number and bank details.",
      redactNow: "Redact now", shareAsIs: "Share as it is",
      newLink: "New link", copy: "Copy", copied: "Copied", done: "Done",
      linkNote: "Copy it now — for your safety it is shown only this once. Anyone with the link can open the documents until it expires or you revoke it.",
      linksH: "Share links", created: d => `Created ${d}`, validUntil: d => `valid until ${d}`,
      state: { active: "Active", expired: "Expired", revoked: "Revoked" },
      opened: n => n === 0 ? "Not opened yet" : n === 1 ? "Opened once" : `Opened ${n} times`, lastOpen: d => `last ${d}`, allOpens: "Every open",
      revoke: "Revoke", confirmRevoke: "Revoke this link? It stops working at once.", deletedDoc: "Deleted document",
      types: { payslip: "Payslip", contract: "Employment contract", schufa: "SCHUFA credit report", id: "ID document", "rent-confirmation": "Rent payment confirmation", "landlord-reference": "Landlord reference", other: "Document" }
    },
    de: {
      locale: "de-DE", title: "Über mich", loading: "Wird geladen …",
      offTitle: "Unterlagen sind ausgeschaltet",
      offWhat: "Selbstauskunft und Unterlagen werden mit einem Schlüssel verschlüsselt gespeichert, den nur dieser Server kennt: die Variable VAULT_KEY.",
      offHow: "Erzeuge ihn mit dem Befehl unten, setze ihn als VAULT_KEY beim Dienst und starte neu.",
      offKeep: "Bewahre eine Kopie im Passwortmanager auf: Ohne denselben Schlüssel lassen sich die gespeicherten Unterlagen nicht mehr lesen.",
      offMore: "Einrichtung in der README", offWrong: "Der Server konnte den Unterlagen-Tresor mit seinem Schlüssel nicht öffnen.",
      profile: "Selbstauskunft", profileIntro: "Was Vermieter meist über dich wissen wollen. Es fließt in die Kurzfassung ein.",
      name: "Name", email: "E-Mail", phone: "Telefon",
      household: "Haushalt", adults: "Erwachsene", children: "Kinder", pets: "Haustiere", petsPh: "z. B. eine Katze",
      job: "Beruf", jobTitle: "Tätigkeit", employer: "Arbeitgeber", since: "Beschäftigt seit", permanent: "Unbefristeter Vertrag",
      papers: "Auf Anfrage vorhanden", schufa: "SCHUFA-Auskunft vorhanden", landlordRef: "Vermieterbescheinigung vorhanden",
      about: "Über uns", aboutPh: "Ein paar Sätze für den Vermieter: wer ihr seid und warum diese Wohnung.",
      save: "Selbstauskunft speichern", saved: "Gespeichert", saveFail: "Speichern fehlgeschlagen", netFail: "Server nicht erreichbar.", fixThis: "Bitte prüfen:",
      summary: "Kurzfassung", summaryBtn: l => `Kurzfassung PDF (${l.toUpperCase()})`,
      summaryHint: "Eine Seite für Vermieter mit deiner Selbstauskunft und dem Nettoeinkommen aus den Einstellungen. Öffnet sich in einem neuen Tab.",
      summaryNeedSave: "Speichere zuerst die Selbstauskunft, dann gibt es die Kurzfassung.",
      docs: "Unterlagen", upload: "Unterlage hinzufügen", file: "Datei (PDF, JPEG oder PNG, bis 10 MB)", type: "Art", label: "Bezeichnung", labelPh: "z. B. Gehalt September",
      date: "Datum der Unterlage (z. B. Abrechnungsmonat)", uploadBtn: "Hochladen", uploading: "Wird hochgeladen …", uploaded: "Hochgeladen", needFile: "Bitte eine Datei wählen.",
      tooBig: "Die Datei ist größer als 10 MB", onlyTypes: "Nur PDF, JPEG oder PNG", notReally: k => `Die Datei ist kein echtes ${k}`,
      badPdf: "Dieses PDF ist verschlüsselt oder beschädigt; drucke es in ein neues PDF und versuche es noch einmal",
      empty: "Noch keine Unterlagen. Vermieter wollen meist die letzten drei Gehaltsnachweise, eine SCHUFA-Auskunft, einen Ausweis, eine Mietzahlungsbestätigung und eine Vermieterbescheinigung sehen.",
      uploadedOn: d => `hochgeladen ${d}`, redacted: "Geschwärzt", outdated: "Älter als 3 Monate",
      outdatedTip: "Vermieter verlangen meist die letzten drei Gehaltsnachweise; dieser ist älter.",
      download: "Herunterladen", edit: "Bearbeiten", redact: "Schwärzen", del: "Löschen", cancel: "Abbrechen", saveDoc: "Speichern",
      confirmDelete: n => `„${n}“ löschen? Die Datei wird aus dem Tresor entfernt und lässt sich nicht wiederherstellen.`,
      // Listing: Documents section
      reqNone: "Noch keine Anforderung von Unterlagen erfasst.", logReq: "Anforderung erfassen", reqWhich: "Was hat der Vermieter angefordert?", reqSave: "Anforderung speichern", needOne: "Bitte mindestens eine Unterlage ankreuzen.",
      approve: "Freigeben und Link erstellen", approveIntro: "Kreuze an, was dieser Vermieter sehen darf. Nur diese Unterlagen sind über den Link erreichbar.",
      summaryNeedApplicant: "Speichere zuerst deine Selbstauskunft unter „Über mich“.", noDocsYet: "Noch keine Unterlagen im Tresor. Füge sie unter „Über mich“ hinzu.",
      days: "Link gültig für (Tage, 1–30)", createLink: "Link erstellen", creating: "Wird erstellt …",
      payTitle: "Gehaltsnachweis nicht geschwärzt", payText: "Bevor du einen Gehaltsnachweis teilst, schwärze Steuer-ID, Sozialversicherungsnummer und Bankverbindung.",
      redactNow: "Jetzt schwärzen", shareAsIs: "So teilen",
      newLink: "Neuer Link", copy: "Kopieren", copied: "Kopiert", done: "Fertig",
      linkNote: "Kopiere ihn jetzt – zu deiner Sicherheit wird er nur dieses eine Mal angezeigt. Wer den Link hat, kann die Unterlagen öffnen, bis er abläuft oder du ihn widerrufst.",
      linksH: "Freigabe-Links", created: d => `Erstellt ${d}`, validUntil: d => `gültig bis ${d}`,
      state: { active: "Aktiv", expired: "Abgelaufen", revoked: "Widerrufen" },
      opened: n => n === 0 ? "Noch nicht geöffnet" : n === 1 ? "Einmal geöffnet" : `${n}-mal geöffnet`, lastOpen: d => `zuletzt ${d}`, allOpens: "Alle Aufrufe",
      revoke: "Widerrufen", confirmRevoke: "Diesen Link widerrufen? Er funktioniert dann sofort nicht mehr.", deletedDoc: "Gelöschte Unterlage",
      types: { payslip: "Gehaltsnachweis", contract: "Arbeitsvertrag", schufa: "SCHUFA-Auskunft", id: "Ausweis", "rent-confirmation": "Mietzahlungsbestätigung", "landlord-reference": "Vermieterbescheinigung", other: "Dokument" }
    },
    pt: {
      locale: "pt-BR", title: "Sobre mim", loading: "Carregando…",
      offTitle: "Os documentos estão desativados",
      offWhat: "Seu perfil de candidato e seus documentos ficam guardados com criptografia, usando uma chave que só este servidor conhece: a variável VAULT_KEY.",
      offHow: "Crie uma com o comando abaixo, defina-a como VAULT_KEY no serviço e reinicie.",
      offKeep: "Guarde uma cópia no seu gerenciador de senhas: sem a mesma chave, os documentos guardados não podem ser lidos.",
      offMore: "Passos de configuração no README", offWrong: "O servidor não conseguiu abrir o cofre de documentos com a chave que tem.",
      profile: "Perfil do candidato", profileIntro: "O que os locadores costumam perguntar sobre você. Entra no resumo do candidato.",
      name: "Nome", email: "E-mail", phone: "Telefone",
      household: "Moradores", adults: "Adultos", children: "Crianças", pets: "Animais", petsPh: "ex.: um gato",
      job: "Trabalho", jobTitle: "Cargo", employer: "Empregador", since: "Empregado desde", permanent: "Contrato por prazo indeterminado",
      papers: "Disponível se pedirem", schufa: "Relatório SCHUFA disponível", landlordRef: "Referência do locador disponível",
      about: "Sobre nós", aboutPh: "Algumas frases para o locador: quem vocês são e por que este apartamento.",
      save: "Salvar perfil", saved: "Salvo", saveFail: "Não foi possível salvar", netFail: "Não foi possível falar com o servidor.", fixThis: "Verifique:",
      summary: "Resumo do candidato", summaryBtn: l => `Resumo em PDF (${l.toUpperCase()})`,
      summaryHint: "Uma página para locadores com seu perfil e a renda líquida das Configurações. Abre em uma nova aba.",
      summaryNeedSave: "Salve o perfil primeiro para gerar o resumo.",
      docs: "Documentos", upload: "Adicionar documento", file: "Arquivo (PDF, JPEG ou PNG, até 10 MB)", type: "Tipo", label: "Descrição", labelPh: "ex.: salário de setembro",
      date: "Data do documento (ex.: mês do pagamento)", uploadBtn: "Enviar", uploading: "Enviando…", uploaded: "Enviado", needFile: "Escolha um arquivo.",
      tooBig: "O arquivo tem mais de 10 MB", onlyTypes: "Somente PDF, JPEG ou PNG", notReally: k => `O arquivo não é realmente um ${k}`,
      badPdf: "Este PDF está criptografado ou danificado; imprima-o em um novo PDF e tente de novo",
      empty: "Nenhum documento ainda. Locadores costumam pedir os três últimos contracheques, um relatório SCHUFA, um documento de identidade, um comprovante de pagamento do aluguel e uma referência do locador.",
      uploadedOn: d => `enviado em ${d}`, redacted: "Tarjado", outdated: "Mais de 3 meses",
      outdatedTip: "Locadores costumam pedir os três últimos contracheques; este é mais antigo.",
      download: "Baixar", edit: "Editar", redact: "Tarjar", del: "Excluir", cancel: "Cancelar", saveDoc: "Salvar",
      confirmDelete: n => `Excluir “${n}”? O arquivo é removido do cofre e não pode ser recuperado.`,
      // Listing: Documents section
      reqNone: "Nenhum pedido de documentos registrado ainda.", logReq: "Registrar pedido", reqWhich: "O que o locador pediu?", reqSave: "Salvar pedido", needOne: "Marque pelo menos um documento.",
      approve: "Aprovar e criar link", approveIntro: "Marque o que este locador pode ver. Só estes documentos ficam acessíveis pelo link.",
      summaryNeedApplicant: "Salve primeiro seu perfil de candidato em “Sobre mim”.", noDocsYet: "Nenhum documento no cofre ainda. Adicione-os em “Sobre mim”.",
      days: "Link válido por (dias, 1–30)", createLink: "Criar link", creating: "Criando…",
      payTitle: "Contracheque sem tarja", payText: "Antes de compartilhar um contracheque, cubra o número de identificação fiscal, o número da previdência social e os dados bancários.",
      redactNow: "Tarjar agora", shareAsIs: "Compartilhar assim",
      newLink: "Novo link", copy: "Copiar", copied: "Copiado", done: "Concluído",
      linkNote: "Copie agora — por segurança, ele só é mostrado esta vez. Quem tiver o link pode abrir os documentos até ele expirar ou você revogá-lo.",
      linksH: "Links compartilhados", created: d => `Criado em ${d}`, validUntil: d => `válido até ${d}`,
      state: { active: "Ativo", expired: "Expirado", revoked: "Revogado" },
      opened: n => n === 0 ? "Ainda não aberto" : n === 1 ? "Aberto uma vez" : `Aberto ${n} vezes`, lastOpen: d => `último ${d}`, allOpens: "Todas as aberturas",
      revoke: "Revogar", confirmRevoke: "Revogar este link? Ele deixa de funcionar na hora.", deletedDoc: "Documento excluído",
      types: { payslip: "Contracheque", contract: "Contrato de trabalho", schufa: "Relatório SCHUFA", id: "Documento de identidade", "rent-confirmation": "Comprovante de pagamento do aluguel", "landlord-reference": "Referência do locador", other: "Documento" }
    }
  };

  const SUMMARY = "summary";
  // Payslips in a selection that are not redacted and were not confirmed as "share as it is" before.
  function pendingPayslips(docs, ids, okIds) {
    const ok = new Set(okIds || []);
    return ids.map(id => docs.find(d => d.id === id)).filter(d => d && d.type === "payslip" && !d.redactedAt && !ok.has(d.id));
  }
  // Ids ticked when the checklist opens: documents whose type is in the newest request, plus the summary if it was asked for and exists.
  function preticked(docs, requests, hasApplicant) {
    const last = Array.isArray(requests) && requests.length ? requests[requests.length - 1] : null;
    if (!last) return [];
    const ids = docs.filter(d => last.types.includes(d.type)).map(d => d.id);
    if (hasApplicant && last.types.includes(SUMMARY)) ids.push(SUMMARY);
    return ids;
  }

  if (typeof window === "undefined") { module.exports = { defaultApplicant, TYPES, L, pendingPayslips, preticked }; return; }

  // ---------- helpers ----------
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const btn = (txt, cls, onclick) => { const b = el("button", cls || "", txt); b.type = "button"; if (onclick) b.onclick = onclick; return b; };
  let uid = 0; const nextId = () => "vu-" + (++uid);
  // A labelled control: <label for> + control, stacked.
  const field = (labelTxt, control, cls) => { const w = el("div", "vu-fld" + (cls ? " " + cls : "")); control.id = control.id || nextId(); const l = el("label", null, labelTxt); l.htmlFor = control.id; w.append(l, control); return w; };
  const input = (type, value, attrs = {}) => { const i = el("input"); i.type = type; if (value != null) i.value = value; for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v); return i; };
  const check = (labelTxt, checked) => { const w = el("label", "vu-check"); const i = input("checkbox"); i.checked = !!checked; w.append(i, el("span", null, labelTxt)); return [w, i]; };
  const typeSelect = (t, value) => { const s = el("select"); TYPES.forEach(k => { const o = el("option", null, t.types[k]); o.value = k; o.selected = k === value; s.append(o); }); return s; };
  const fmtDay = (t, iso) => { if (!iso) return ""; const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso); if (isNaN(d)) return iso; return d.toLocaleDateString(t.locale, { day: "2-digit", month: "2-digit", year: "numeric", ...(iso.length === 10 ? { timeZone: "UTC" } : {}) }); };
  const fmtSize = (t, n) => { const nf = d => new Intl.NumberFormat(t.locale, { maximumFractionDigits: d }); return n < 1024 * 1024 ? nf(0).format(Math.max(1, Math.round(n / 1024))) + " KB" : nf(1).format(n / 1024 / 1024) + " MB"; };
  const docName = (t, d) => [t.types[d.type] || d.type, d.label, d.date ? fmtDay(t, d.date) : ""].filter(Boolean).join(" · ");
  const mimeOf = f => f.type || MIME_BY_EXT[(f.name.split(".").pop() || "").toLowerCase()] || "application/octet-stream";
  const flash = (node, txt) => { node.textContent = txt; clearTimeout(node._t); node._t = setTimeout(() => { node.textContent = ""; }, 1500); };
  class Off extends Error {}
  async function api(url, opts) {
    const r = await fetch(url, { cache: "no-store", ...opts });
    if (r.status === 503) throw new Off();
    return r;
  }

  // ---------- vault off ----------
  function renderOff(host, t, status) {
    const box = el("div", "vu-off");
    box.append(el("h3", null, t.offTitle));
    if (status === "wrong-key") box.append(el("p", null, t.offWrong));
    box.append(el("p", null, t.offWhat), el("p", null, t.offHow));
    const pre = el("pre", "vu-cmd"); pre.append(el("code", null, "openssl rand -base64 32")); box.append(pre);
    box.append(el("p", null, t.offKeep));
    const p = el("p"); const a = el("a", null, t.offMore); a.href = README_URL; a.target = "_blank"; a.rel = "noopener"; p.append(a); box.append(p);
    host.append(box);
  }

  // ---------- applicant form ----------
  function applicantForm(t, applicant, langs, onOff) {
    const A = applicant || defaultApplicant();
    const wrap = el("div", "vu-card vu-applicant");
    wrap.append(el("h3", null, t.profile), el("p", "vu-hint", t.profileIntro));
    const form = el("form", "vu-form"); form.noValidate = true;

    const name = input("text", A.name, { maxlength: 120, autocomplete: "name", required: "" });
    const email = input("email", A.email, { maxlength: 200, autocomplete: "email" });
    const phone = input("tel", A.phone, { maxlength: 30, autocomplete: "tel" });
    const contact = el("div", "vu-row"); contact.append(field(t.email, email), field(t.phone, phone));
    form.append(field(t.name, name), contact);

    const adults = input("number", A.household.adults, { min: 1, max: 10, step: 1, inputmode: "numeric" });
    const children = input("number", A.household.children, { min: 0, max: 10, step: 1, inputmode: "numeric" });
    const pets = input("text", A.household.pets, { maxlength: 100, placeholder: t.petsPh });
    const hh = el("fieldset", "vu-set"); hh.append(el("legend", null, t.household));
    const hhRow = el("div", "vu-row vu-row3"); hhRow.append(field(t.adults, adults), field(t.children, children), field(t.pets, pets)); hh.append(hhRow);
    form.append(hh);

    const jobTitle = input("text", A.job.title, { maxlength: 120, autocomplete: "organization-title" });
    const employer = input("text", A.job.employer, { maxlength: 120, autocomplete: "organization" });
    const since = input("month", A.job.since || "", { max: new Date().toISOString().slice(0, 7), placeholder: "YYYY-MM" });
    const [permW, perm] = check(t.permanent, A.job.permanent);
    const job = el("fieldset", "vu-set"); job.append(el("legend", null, t.job));
    const jr = el("div", "vu-row"); jr.append(field(t.jobTitle, jobTitle), field(t.employer, employer));
    const jr2 = el("div", "vu-row vu-row-end"); jr2.append(field(t.since, since), permW);
    job.append(jr, jr2); form.append(job);

    const [schufaW, schufa] = check(t.schufa, A.schufaAvailable);
    const [refW, ref] = check(t.landlordRef, A.landlordReferenceAvailable);
    const papers = el("fieldset", "vu-set"); papers.append(el("legend", null, t.papers), schufaW, refW); form.append(papers);

    const about = el("textarea"); about.value = A.about; about.maxLength = 1000; about.rows = 5; about.placeholder = t.aboutPh;
    const count = el("div", "vu-count num"); const upd = () => { count.textContent = `${about.value.length} / 1000`; }; about.oninput = upd; upd();
    const af = field(t.about, about); af.append(count); form.append(af);

    const err = el("div", "vu-err"); err.setAttribute("role", "alert");
    const note = el("span", "vu-saved"); note.setAttribute("role", "status");
    const save = el("button", "vu-btn primary", t.save); save.type = "submit";
    const bar = el("div", "vu-bar"); bar.append(save, note);
    form.append(err, bar);

    // Summary: one button per page language, enabled once the profile is saved.
    const sum = el("div", "vu-summary");
    sum.append(el("h4", null, t.summary));
    const sumBtns = el("div", "vu-btns");
    const hint = el("p", "vu-hint");
    let saved = !!applicant;
    const syncSummary = () => { sumBtns.querySelectorAll("button").forEach(b => { b.disabled = !saved; }); hint.textContent = saved ? t.summaryHint : t.summaryNeedSave; };
    langs.forEach(l => sumBtns.append(btn(t.summaryBtn(l), "vu-btn", () => window.open("/api/applicant/summary.pdf?lang=" + encodeURIComponent(l), "_blank", "noopener"))));
    sum.append(sumBtns, hint); syncSummary();

    form.onsubmit = async e => {
      e.preventDefault();
      err.textContent = ""; note.textContent = "";
      const num = (i, d) => i.value.trim() === "" ? d : Number(i.value);
      const body = {
        name: name.value, email: email.value.trim(), phone: phone.value.trim(),
        household: { adults: num(adults, NaN), children: num(children, 0), pets: pets.value.trim() },
        job: { title: jobTitle.value.trim(), employer: employer.value.trim(), since: since.value || null, permanent: perm.checked },
        schufaAvailable: schufa.checked, landlordReferenceAvailable: ref.checked,
        about: about.value
      };
      save.disabled = true;
      let r;
      try { r = await api("/api/applicant", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
      catch (x) { save.disabled = false; if (x instanceof Off) return onOff(); err.textContent = t.netFail; return; }
      save.disabled = false;
      if (r.status === 400) {
        const j = await r.json().catch(() => ({}));
        err.append(el("strong", null, t.fixThis));
        const ul = el("ul"); (j.details || [j.error || t.saveFail]).forEach(d => ul.append(el("li", null, d))); err.append(ul);
        return;
      }
      if (!r.ok) { err.textContent = t.saveFail; return; }
      const j = await r.json().catch(() => ({}));
      if (j.applicant) name.value = j.applicant.name;
      saved = true; syncSummary(); flash(note, t.saved);
    };
    wrap.append(form, sum);
    return wrap;
  }

  // ---------- documents ----------
  function uploadErrorText(t, status, j, mime) {
    const e = String(j.error || "");
    if (status === 413) return t.tooBig;
    if (status === 415) return t.onlyTypes;
    if (status === 400 && e === "file content does not match its type") return t.notReally(KIND[mime] || mime);
    if (status === 400 && e.startsWith("pdf cannot be read")) return t.badPdf;
    return t.saveFail + (Array.isArray(j.details) && j.details.length ? ": " + j.details.join("; ") : "");
  }

  function docsPanel(t, lang, onOff) {
    const wrap = el("div", "vu-card vu-docs");
    wrap.append(el("h3", null, t.docs));

    // Upload
    const up = el("form", "vu-form vu-upload"); up.noValidate = true;
    up.append(el("h4", null, t.upload));
    const file = input("file", null, { accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" });
    const type = typeSelect(t, "payslip");
    const label = input("text", "", { maxlength: 120, placeholder: t.labelPh });
    const date = input("date", "");
    up.append(field(t.file, file));
    const r1 = el("div", "vu-row"); r1.append(field(t.type, type), field(t.date, date)); up.append(r1);
    up.append(field(t.label, label));
    const uerr = el("div", "vu-err"); uerr.setAttribute("role", "alert");
    const unote = el("span", "vu-saved"); unote.setAttribute("role", "status");
    const ubtn = el("button", "vu-btn primary", t.uploadBtn); ubtn.type = "submit";
    const ubar = el("div", "vu-bar"); ubar.append(ubtn, unote);
    up.append(uerr, ubar);

    const list = el("div", "vu-list"); list.setAttribute("aria-live", "polite");
    wrap.append(up, list);

    // Type, label and date go in a header (base64url JSON), not the URL: URLs end up in access logs.
    const metaHeader = m => { let bin = ""; for (const b of new TextEncoder().encode(JSON.stringify(m))) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
    up.onsubmit = async e => {
      e.preventDefault();
      uerr.textContent = ""; unote.textContent = "";
      const f = file.files && file.files[0];
      if (!f) { uerr.textContent = t.needFile; return; }
      if (f.size > MAX_BYTES) { uerr.textContent = t.tooBig; return; }
      const mime = mimeOf(f);
      ubtn.disabled = true; unote.textContent = t.uploading;
      let r;
      try { r = await api("/api/vault", { method: "POST", headers: { "Content-Type": mime, "X-Doc-Meta": metaHeader({ type: type.value, label: label.value.trim(), date: date.value }) }, body: f }); }
      catch (x) { ubtn.disabled = false; unote.textContent = ""; if (x instanceof Off) return onOff(); uerr.textContent = t.netFail; return; }
      ubtn.disabled = false; unote.textContent = "";
      if (!r.ok) { const j = await r.json().catch(() => ({})); uerr.textContent = uploadErrorText(t, r.status, j, mime); return; }
      file.value = ""; label.value = ""; date.value = "";
      flash(unote, t.uploaded);
      loadList();
    };

    async function loadList() {
      let r;
      try { r = await api("/api/vault"); }
      catch (x) { if (x instanceof Off) return onOff(); list.replaceChildren(el("p", "vu-err", t.netFail)); return; }
      if (!r.ok) { list.replaceChildren(el("p", "vu-err", t.saveFail)); return; }
      const docs = (await r.json()).docs || [];
      if (!docs.length) { list.replaceChildren(el("p", "vu-empty", t.empty)); return; }
      const ul = el("ul", "vu-rows");
      docs.forEach(d => ul.append(docRow(d)));
      list.replaceChildren(ul);
    }

    function docRow(d) {
      const li = el("li", "vu-doc");
      const main = el("div", "vu-docmain");
      const head = el("div", "vu-dochead");
      head.append(el("strong", null, t.types[d.type] || d.type));
      if (d.redactedAt) head.append(el("span", "vu-badge good", t.redacted));
      if (d.outdated) { const b = el("span", "vu-badge warn", t.outdated); b.title = t.outdatedTip; head.append(b); }
      main.append(head);
      if (d.label) main.append(el("div", "vu-doclabel", d.label));
      main.append(el("div", "vu-docmeta num", [d.date ? fmtDay(t, d.date) : "", fmtSize(t, d.size), t.uploadedOn(fmtDay(t, d.uploadedAt))].filter(Boolean).join(" · ")));
      const acts = el("div", "vu-btns vu-docacts");
      const dl = el("a", "vu-btn", t.download); dl.href = "/api/vault/" + encodeURIComponent(d.id); dl.setAttribute("download", "");
      const err = el("div", "vu-err"); err.setAttribute("role", "alert");
      const ed = btn(t.edit, "vu-btn", () => { li.replaceChildren(editRow(d)); });
      const rd = btn(t.redact, "vu-btn", () => window.Redact.open({ doc: d, lang, onSaved: loadList })); rd.hidden = !window.Redact;
      const del = btn(t.del, "vu-btn danger", async () => {
        if (!confirm(t.confirmDelete(docName(t, d)))) return;
        del.disabled = true; err.textContent = "";
        let r;
        try { r = await api("/api/vault/" + encodeURIComponent(d.id), { method: "DELETE" }); }
        catch (x) { del.disabled = false; if (x instanceof Off) return onOff(); err.textContent = t.netFail; return; }
        del.disabled = false;
        if (!r.ok && r.status !== 404) { err.textContent = t.saveFail; return; }
        loadList();
      });
      acts.append(dl, ed, rd, del);
      li.append(main, acts, err);
      return li;
    }

    function editRow(d) {
      const f = el("form", "vu-form vu-edit"); f.noValidate = true;
      const ty = typeSelect(t, d.type);
      const lb = input("text", d.label || "", { maxlength: 120, placeholder: t.labelPh });
      const dt = input("date", d.date || "");
      const r = el("div", "vu-row"); r.append(field(t.type, ty), field(t.date, dt));
      const err = el("div", "vu-err"); err.setAttribute("role", "alert");
      const ok = el("button", "vu-btn primary", t.saveDoc); ok.type = "submit";
      const bar = el("div", "vu-bar"); bar.append(ok, btn(t.cancel, "vu-btn", () => loadList()));
      f.append(r, field(t.label, lb), err, bar);
      f.onsubmit = async e => {
        e.preventDefault(); err.textContent = "";
        const patch = {};
        if (ty.value !== d.type) patch.type = ty.value;
        if (lb.value.trim() !== (d.label || "")) patch.label = lb.value.trim();
        if ((dt.value || null) !== (d.date || null)) patch.date = dt.value || null;
        if (!Object.keys(patch).length) return loadList();
        ok.disabled = true;
        let res;
        try { res = await api("/api/vault/" + encodeURIComponent(d.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }); }
        catch (x) { ok.disabled = false; if (x instanceof Off) return onOff(); err.textContent = t.netFail; return; }
        ok.disabled = false;
        if (!res.ok) { const j = await res.json().catch(() => ({})); err.textContent = t.saveFail + (Array.isArray(j.details) ? ": " + j.details.join("; ") : ""); return; }
        loadList();
      };
      setTimeout(() => lb.focus(), 0);
      return f;
    }

    list.append(el("p", "vu-empty", t.loading));
    loadList();
    return wrap;
  }

  // ---------- About me ----------
  async function mountAbout(host, { lang } = {}) {
    const t = L[lang] || L.en;
    const gen = host._vuGen = (host._vuGen || 0) + 1;
    const live = () => host._vuGen === gen;
    host.replaceChildren(el("h2", null, t.title), el("p", "vu-empty", t.loading));
    const off = status => { if (!live()) return; host.replaceChildren(el("h2", null, t.title)); renderOff(host, t, status); };
    let status = "off";
    try { const r = await fetch("/api/vault/status", { cache: "no-store" }); if (r.ok) status = (await r.json()).status; } catch (e) {}
    if (!live()) return;
    if (status !== "ready") return off(status);
    let applicant = null;
    try {
      const r = await api("/api/applicant");
      if (r.ok) applicant = (await r.json()).applicant || null;
      else if (r.status !== 404) throw new Error(r.status);
    } catch (e) {
      if (e instanceof Off) return off("off");
      if (!live()) return;
      host.replaceChildren(el("h2", null, t.title), el("p", "vu-err", t.netFail)); return;
    }
    if (!live()) return;
    const P = window.FlatHunt && window.FlatHunt.profile && window.FlatHunt.profile();
    const langs = (P && Array.isArray(P.languages) && P.languages.length ? P.languages : [lang]).filter(l => L[l]);
    const grid = el("div", "vu-grid");
    grid.append(applicantForm(t, applicant, langs, () => off("off")), docsPanel(t, lang, () => off("off")));
    host.replaceChildren(el("h2", null, t.title), grid);
  }

  // ---------- listing: Documents section ----------
  // State per listing survives the page's re-renders (60-second refresh, saves): open panel, ticks, the new link.
  // The new link lives only here, in memory, until "Done" or a page reload; the server never returns it again.
  const LD = new Map();
  const OK_KEY = "flathunt-payslip-ok";
  const okIds = () => { try { const v = JSON.parse(localStorage.getItem(OK_KEY) || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; } catch (e) { return []; } };
  const addOk = id => { try { const v = okIds(); if (!v.includes(id)) localStorage.setItem(OK_KEY, JSON.stringify([...v, id].slice(-200))); } catch (e) {} };
  const fmtTime = (t, iso) => { const d = new Date(iso); if (isNaN(d)) return iso || ""; return fmtDay(t, iso) + " " + d.toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit" }); };
  const reqName = (t, k) => k === SUMMARY ? t.summary : t.types[k] || k;

  function listingDocs(host, listing, { lang, onChanged } = {}) {
    const id = listing.id;
    const m = LD.get(id) || { panel: null, sel: null, reqSel: null, days: 7, newUrl: "", data: null };
    LD.set(id, m);
    Object.assign(m, { host, listing, lang, t: L[lang] || L.en, onChanged: typeof onChanged === "function" ? onChanged : () => {} });
    host.hidden = false;
    host.classList.add("docs");
    draw(m);
    reloadDocs(m);
  }

  async function reloadDocs(m) {
    const lid = encodeURIComponent(m.listing.id);
    let status = "off";
    try { const r = await fetch("/api/vault/status", { cache: "no-store" }); if (r.ok) status = (await r.json()).status; } catch (e) {}
    if (status !== "ready") { m.data = { off: status }; return draw(m); }
    try {
      const [rv, ra, rs] = await Promise.all([api("/api/vault"), api("/api/applicant"), api(`/api/listings/${lid}/shares`)]);
      if (!rv.ok || !rs.ok || (!ra.ok && ra.status !== 404)) throw new Error("load");
      m.data = { docs: (await rv.json()).docs || [], hasApplicant: ra.ok, shares: (await rs.json()).shares || [] };
    } catch (e) {
      m.data = e instanceof Off ? { off: "off" } : { error: true };
    }
    draw(m);
  }

  function draw(m) {
    const { host, t } = m;
    const kids = [el("h3", null, t.docs), requestsBlock(m)];
    const D = m.data;
    if (!D) kids.push(el("p", "vu-empty", t.loading));
    else if (D.off) {
      const box = el("div", "vu-off ld-off");
      box.append(el("strong", null, t.offTitle));
      if (D.off === "wrong-key") box.append(el("p", null, t.offWrong));
      box.append(el("p", null, t.offHow));
      const pre = el("pre", "vu-cmd"); pre.append(el("code", null, "openssl rand -base64 32")); box.append(pre);
      const p = el("p"); const a = el("a", null, t.offMore); a.href = README_URL; a.target = "_blank"; a.rel = "noopener"; p.append(a); box.append(p);
      kids.push(box);
    } else if (D.error) kids.push(el("p", "vu-err", t.netFail));
    else {
      if (m.newUrl) kids.push(newLinkBlock(m));
      kids.push(m.panel === "share" ? shareForm(m) : btn(t.approve, "vu-btn primary ld-open", () => { m.panel = "share"; m.sel = null; draw(m); }));
      kids.push(sharesBlock(m));
    }
    host.replaceChildren(...kids);
  }

  // Logged requests, newest first, and the "Log a request" form. Needs no vault.
  function requestsBlock(m) {
    const { t, listing } = m;
    const wrap = el("div", "ld-reqs");
    const reqs = [...(listing.docRequests || [])].reverse();
    if (!reqs.length) wrap.append(el("p", "vu-empty", t.reqNone));
    else { const ul = el("ul", "ld-reqlist"); reqs.forEach(r => ul.append(el("li", null, `${fmtDay(t, r.at)}: ${(r.types || []).map(k => reqName(t, k)).join(", ")}`))); wrap.append(ul); }
    if (m.panel !== "request") { wrap.append(btn(t.logReq, "vu-btn ld-open", () => { m.panel = "request"; m.reqSel = []; draw(m); })); return wrap; }

    const f = el("form", "vu-form ld-panel"); f.noValidate = true;
    const set = el("fieldset", "vu-set"); set.append(el("legend", null, t.reqWhich));
    const grid = el("div", "ld-checks");
    [...TYPES, SUMMARY].forEach(k => {
      const [w, i] = check(reqName(t, k), m.reqSel.includes(k));
      i.onchange = () => { m.reqSel = i.checked ? [...m.reqSel, k] : m.reqSel.filter(x => x !== k); };
      grid.append(w);
    });
    set.append(grid); f.append(set);
    const err = el("div", "vu-err"); err.setAttribute("role", "alert");
    const ok = el("button", "vu-btn primary", t.reqSave); ok.type = "submit";
    const bar = el("div", "vu-bar"); bar.append(ok, btn(t.cancel, "vu-btn", () => { m.panel = null; draw(m); }));
    f.append(err, bar);
    f.onsubmit = async e => {
      e.preventDefault(); err.textContent = "";
      const types = [...TYPES, SUMMARY].filter(k => m.reqSel.includes(k));
      if (!types.length) { err.textContent = t.needOne; return; }
      ok.disabled = true;
      let r;
      try { r = await fetch(`/api/listings/${encodeURIComponent(listing.id)}/doc-requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ types }), cache: "no-store" }); }
      catch (x) { ok.disabled = false; err.textContent = t.netFail; return; }
      ok.disabled = false;
      if (!r.ok) { err.textContent = t.saveFail; return; }
      const j = await r.json().catch(() => ({}));
      if (j.listing) m.listing = { ...j.listing, id: listing.id };
      m.panel = null; m.reqSel = null;
      draw(m);
      m.onChanged(m.listing);
    };
    wrap.append(f);
    return wrap;
  }

  // Checklist of vault documents plus the summary, link duration, Create.
  function shareForm(m) {
    const { t } = m, D = m.data;
    if (!m.sel) m.sel = preticked(D.docs, m.listing.docRequests, D.hasApplicant);
    const f = el("form", "vu-form ld-panel"); f.noValidate = true;
    f.append(el("p", "vu-hint", t.approveIntro));
    const ul = el("ul", "vu-rows ld-pick");
    const row = (key, head, meta, disabled) => {
      const li = el("li", "vu-doc");
      const w = el("label", "vu-check ld-pickrow"); const i = input("checkbox"); i.checked = m.sel.includes(key) && !disabled; i.disabled = !!disabled;
      i.onchange = () => { m.sel = i.checked ? [...m.sel, key] : m.sel.filter(x => x !== key); };
      const txt = el("span", "vu-docmain"); txt.append(head); if (meta) txt.append(meta);
      w.append(i, txt); li.append(w); ul.append(li);
    };
    if (!D.docs.length) f.append(el("p", "vu-empty", t.noDocsYet));
    D.docs.forEach(d => {
      const head = el("span", "vu-dochead"); head.append(el("strong", null, t.types[d.type] || d.type));
      if (d.redactedAt) head.append(el("span", "vu-badge good", t.redacted));
      if (d.outdated) { const b = el("span", "vu-badge warn", t.outdated); b.title = t.outdatedTip; head.append(b); }
      const meta = [d.label, d.date ? fmtDay(t, d.date) : ""].filter(Boolean).join(" · ");
      row(d.id, head, meta ? el("span", "vu-docmeta", meta) : null, false);
    });
    const sh = el("span", "vu-dochead"); sh.append(el("strong", null, t.summary));
    row(SUMMARY, sh, D.hasApplicant ? null : el("span", "vu-docmeta", t.summaryNeedApplicant), !D.hasApplicant);
    f.append(ul);
    const days = input("number", m.days, { min: 1, max: 30, step: 1, inputmode: "numeric" });
    days.oninput = () => { m.days = days.value; };
    f.append(field(t.days, days, "ld-days"));
    const err = el("div", "vu-err"); err.setAttribute("role", "alert");
    const ok = el("button", "vu-btn primary", t.createLink); ok.type = "submit";
    const bar = el("div", "vu-bar"); bar.append(ok, btn(t.cancel, "vu-btn", () => { m.panel = null; m.sel = null; draw(m); }));
    f.append(err, bar);
    f.onsubmit = e => { e.preventDefault(); create(m, err, ok); };
    return f;
  }

  async function create(m, err, ok) {
    const { t } = m, D = m.data;
    err.textContent = "";
    const known = new Set([...D.docs.map(d => d.id), ...(D.hasApplicant ? [SUMMARY] : [])]);
    const docIds = m.sel.filter(x => known.has(x));
    if (!docIds.length) { err.textContent = t.needOne; return; }
    const days = Number(m.days);
    const pending = pendingPayslips(D.docs, docIds, okIds());
    if (pending.length) return payslipWarning(m, pending[0], () => create(m, err, ok));
    ok.disabled = true; ok.textContent = t.creating;
    let r;
    try { r = await api(`/api/listings/${encodeURIComponent(m.listing.id)}/shares`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docIds, days }) }); }
    catch (x) { ok.disabled = false; ok.textContent = t.createLink; if (x instanceof Off) { m.data = { off: "off" }; return draw(m); } err.textContent = t.netFail; return; }
    ok.disabled = false; ok.textContent = t.createLink;
    const j = await r.json().catch(() => ({}));
    if (r.status === 400) {
      err.append(el("strong", null, t.fixThis));
      const ul = el("ul"); (j.details || [j.error || t.saveFail]).forEach(d => ul.append(el("li", null, d))); err.append(ul);
      return;
    }
    if (r.status !== 201 || !j.url) { err.textContent = t.saveFail; return; }
    m.newUrl = location.origin + j.url;
    m.panel = null; m.sel = null; m.days = 7;
    draw(m);
    reloadDocs(m);
  }

  // Once per payslip: a reminder to cover the tax ID, social-security number and bank details.
  function payslipWarning(m, doc, proceed) {
    const { t } = m;
    const dlg = el("dialog", "sx ld-warn");
    dlg.setAttribute("aria-labelledby", "ld-warn-title");
    const form = el("form"); form.method = "dialog";
    const head = el("div", "sxhead"); const h2 = el("h2", null, t.payTitle); h2.id = "ld-warn-title"; head.append(h2);
    const body = el("div", "sxbody"); body.append(el("p", null, t.payText), el("p", "hint", docName(t, doc)));
    const foot = el("div", "sxfoot"); const bar = el("div", "bar");
    const redactB = btn(t.redactNow, "primary", () => {
      dlg.close();
      window.Redact.open({ doc, lang: m.lang, onSaved: () => reloadDocs(m) });
    });
    redactB.hidden = !window.Redact;
    const anyway = btn(t.shareAsIs, "", () => { addOk(doc.id); dlg.close(); proceed(); });
    bar.append(btn(t.cancel, "", () => dlg.close()), el("span"), anyway, redactB);
    foot.append(bar); form.append(head, body, foot); dlg.append(form);
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    (window.Redact ? redactB : anyway).focus();
  }

  function newLinkBlock(m) {
    const { t } = m;
    const box = el("div", "vu-card ld-new"); box.setAttribute("role", "status");
    box.append(el("h4", null, t.newLink));
    const inp = input("text", m.newUrl, { readonly: "", "aria-label": t.newLink, spellcheck: "false" });
    inp.onfocus = () => inp.select();
    const note = el("span", "vu-saved");
    const copy = btn(t.copy, "vu-btn primary", async () => {
      try { await navigator.clipboard.writeText(m.newUrl); flash(note, t.copied); }
      catch (e) { inp.focus(); inp.select(); }
    });
    const row = el("div", "ld-linkrow"); row.append(inp, copy);
    const bar = el("div", "vu-bar"); bar.append(btn(t.done, "vu-btn", () => { m.newUrl = ""; draw(m); }), note);
    box.append(row, el("p", "vu-hint", t.linkNote), bar);
    return box;
  }

  function sharesBlock(m) {
    const { t } = m, D = m.data;
    const wrap = el("div", "ld-shares");
    if (!D.shares.length) return wrap;
    wrap.append(el("h4", null, t.linksH));
    const names = new Map(D.docs.map(d => [d.id, docName(t, d)]));
    const nameOf = id => id === SUMMARY ? t.summary : names.get(id) || t.deletedDoc;
    const ul = el("ul", "vu-rows");
    D.shares.forEach(s => {
      const st = s.revokedAt ? "revoked" : s.active ? "active" : "expired";
      const li = el("li", "vu-doc ld-share");
      const head = el("div", "vu-dochead");
      head.append(el("span", "pill " + { active: "s-accepted", expired: "s-new", revoked: "s-rejected" }[st], t.state[st]));
      head.append(el("span", "vu-docmeta num", `${t.created(fmtTime(t, s.createdAt))} · ${t.validUntil(fmtTime(t, s.expiresAt))}`));
      li.append(head, el("div", "vu-doclabel", (s.docIds || []).map(nameOf).join(", ")));
      const opens = s.opens || [];
      const last = opens.length ? opens[opens.length - 1] : null;
      const line = t.opened(opens.length) + (last ? " · " + t.lastOpen(fmtTime(t, last.at)) : "");
      if (opens.length) {
        const det = el("details", "ld-opens"); det.append(el("summary", null, line));
        const ol = el("ol"); [...opens].reverse().forEach(o => ol.append(el("li", "num", `${fmtTime(t, o.at)} · ${nameOf(o.docId)}`))); det.append(ol);
        li.append(det);
      } else li.append(el("div", "vu-docmeta", line));
      if (st === "active") {
        const err = el("div", "vu-err"); err.setAttribute("role", "alert");
        const rv = btn(t.revoke, "vu-btn danger", async () => {
          if (!confirm(t.confirmRevoke)) return;
          rv.disabled = true; err.textContent = "";
          let r;
          try { r = await api("/api/shares/" + encodeURIComponent(s.id), { method: "DELETE" }); }
          catch (x) { rv.disabled = false; if (x instanceof Off) { m.data = { off: "off" }; return draw(m); } err.textContent = t.netFail; return; }
          rv.disabled = false;
          if (!r.ok && r.status !== 404) { err.textContent = t.saveFail; return; }
          reloadDocs(m);
        });
        const acts = el("div", "vu-btns vu-docacts"); acts.append(rv); li.append(acts, err);
      }
      ul.append(li);
    });
    wrap.append(ul);
    return wrap;
  }

  window.VaultUI = { mountAbout, listingDocs, TYPES, L };
})();
