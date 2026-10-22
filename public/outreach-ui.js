// public/outreach-ui.js — "Contacting landlords": template editor with approvals (Settings), the header pause switch with
// today's count, viewing proposals and message tags on the listing. Strings and helpers are shared with the tests.
(function () {
  const TEMPLATE_IDS = ["first-contact", "viewing-confirmation", "documents-follow", "decline"];
  const TEMPLATE_LANGS = ["de", "en"];
  const INTENTS = ["viewing-invite", "documents-request", "rejection", "question", "other"];

  const L = {
    en: {
      locale: "en-GB",
      templatesH: "Message templates", templatesIntro: "The routine sends only approved templates, filled from your applicant profile and the listing. Editing a template withdraws its approval.",
      names: { "first-contact": "First contact", "viewing-confirmation": "Viewing confirmation", "documents-follow": "Documents follow", decline: "Not interested anymore" },
      when: {
        "first-contact": "Sent once to a shortlisted listing that meets all your criteria.",
        "viewing-confirmation": "Sent after you confirm one of the proposed viewing times on the listing.",
        "documents-follow": "Sent when a landlord asks for documents. It only announces them: documents leave only through a link you approve.",
        decline: "Sent when you set a listing you already contacted to “Dropped”."
      },
      approved: (d, v) => `Approved ${d} · version ${v}`, notApproved: v => `Not approved · version ${v}`,
      placeholders: "Placeholders (click to insert)", save: "Save text", saved: "Saved", preview: "Preview", approve: "Approve this version", withdraw: "Withdraw approval",
      saveFirst: "Save the text first, then approve it.", discardConfirm: "Discard your unsaved changes to this text?", previewExample: "Preview with an example listing and your applicant profile.",
      missing: list => `Missing for sending: ${list}. Fill them in under About me or Settings; until then the routine skips this template.`,
      failed: "Could not save", netFail: "Could not reach the server.", changedMeanwhile: "The template changed meanwhile; reload Settings.",
      sendOn: "Sending on", sendPaused: "Sending paused", sentToday: (n, cap) => `${n}/${cap} today`,
      pauseTip: "Click to pause the routine's messages at once.", resumeTip: "Click to let the routine send approved templates again.",
      resumeConfirm: "Resume sending? From its next run the routine may send approved templates again.", pauseFail: "Could not change the pause switch.",
      viewingsH: "Viewing proposals", proposed: "Viewing proposed", pickTime: "Pick a time", confirmTime: "Confirm this time", decline: "Decline",
      noTimes: "No time proposed. Answer the landlord yourself.", confirmed: t => `Viewing confirmed: ${t}`, confirmationSent: d => `Confirmation sent ${d}.`,
      confirmationPending: "The routine sends the confirmation in its next run, if the template is approved.",
      declined: "Declined. Nothing was sent; answer the landlord yourself if you like.", cancelled: "Cancelled: the landlord withdrew.",
      me: "Me (routine)", templateTag: (name, v, lang) => `Template: ${name}${v == null ? "" : ` · v${v}`} · ${lang.toUpperCase()}`,
      intents: { "viewing-invite": "Viewing invitation", "documents-request": "Documents request", rejection: "Rejection", question: "Question", other: "Other" },
      upSent: "Message sent", upReply: "Reply", upSkipped: "Skipped (already in contact)", upExpired: "Expired, maybe sent: check", viewingBadge: "Viewing to confirm",
      claimOpen: "The confirmation is being sent right now. Try again in a minute."
    },
    de: {
      locale: "de-DE",
      templatesH: "Nachrichtenvorlagen", templatesIntro: "Die Routine verschickt nur freigegebene Vorlagen, gefüllt aus deinem Bewerberprofil und der Anzeige. Wer eine Vorlage ändert, hebt ihre Freigabe auf.",
      names: { "first-contact": "Erstkontakt", "viewing-confirmation": "Besichtigung bestätigen", "documents-follow": "Unterlagen folgen", decline: "Kein Interesse mehr" },
      when: {
        "first-contact": "Geht einmal an eine vorgemerkte Anzeige, die alle deine Kriterien erfüllt.",
        "viewing-confirmation": "Geht raus, nachdem du auf der Anzeige einen der vorgeschlagenen Besichtigungstermine bestätigt hast.",
        "documents-follow": "Geht raus, wenn ein Vermieter Unterlagen anfragt. Sie kündigt sie nur an: Unterlagen gehen nur über einen Link raus, den du freigibst.",
        decline: "Geht raus, wenn du eine bereits angeschriebene Anzeige auf „Gestrichen“ setzt."
      },
      approved: (d, v) => `Freigegeben am ${d} · Version ${v}`, notApproved: v => `Nicht freigegeben · Version ${v}`,
      placeholders: "Platzhalter (zum Einfügen klicken)", save: "Text speichern", saved: "Gespeichert", preview: "Vorschau", approve: "Diese Version freigeben", withdraw: "Freigabe aufheben",
      saveFirst: "Erst den Text speichern, dann freigeben.", discardConfirm: "Ungespeicherte Änderungen an diesem Text verwerfen?", previewExample: "Vorschau mit einer Beispielanzeige und deinem Bewerberprofil.",
      missing: list => `Fehlt zum Senden: ${list}. Trag es unter „Über mich“ oder in den Einstellungen ein; bis dahin überspringt die Routine diese Vorlage.`,
      failed: "Konnte nicht speichern", netFail: "Server nicht erreichbar.", changedMeanwhile: "Die Vorlage wurde inzwischen geändert; Einstellungen neu öffnen.",
      sendOn: "Senden an", sendPaused: "Senden pausiert", sentToday: (n, cap) => `${n}/${cap} heute`,
      pauseTip: "Klicken, um die Nachrichten der Routine sofort zu pausieren.", resumeTip: "Klicken, damit die Routine freigegebene Vorlagen wieder senden darf.",
      resumeConfirm: "Senden fortsetzen? Ab ihrem nächsten Lauf darf die Routine freigegebene Vorlagen wieder senden.", pauseFail: "Der Pausenschalter konnte nicht umgestellt werden.",
      viewingsH: "Besichtigungstermine", proposed: "Besichtigung vorgeschlagen", pickTime: "Termin wählen", confirmTime: "Diesen Termin bestätigen", decline: "Ablehnen",
      noTimes: "Kein Termin vorgeschlagen. Antworte dem Vermieter selbst.", confirmed: t => `Besichtigung bestätigt: ${t}`, confirmationSent: d => `Bestätigung gesendet am ${d}.`,
      confirmationPending: "Die Routine schickt die Bestätigung bei ihrem nächsten Lauf, wenn die Vorlage freigegeben ist.",
      declined: "Abgelehnt. Es wurde nichts gesendet; antworte dem Vermieter bei Bedarf selbst.", cancelled: "Abgesagt: Der Vermieter hat zurückgezogen.",
      me: "Ich (Routine)", templateTag: (name, v, lang) => `Vorlage: ${name}${v == null ? "" : ` · V${v}`} · ${lang.toUpperCase()}`,
      intents: { "viewing-invite": "Besichtigungseinladung", "documents-request": "Unterlagenanfrage", rejection: "Absage", question: "Frage", other: "Sonstiges" },
      upSent: "Nachricht gesendet", upReply: "Antwort", upSkipped: "Übersprungen (schon in Kontakt)", upExpired: "Abgelaufen, evtl. gesendet: prüfen", viewingBadge: "Termin bestätigen",
      claimOpen: "Die Bestätigung wird gerade gesendet. Versuche es in einer Minute noch einmal."
    },
    pt: {
      locale: "pt-BR",
      templatesH: "Modelos de mensagem", templatesIntro: "A rotina envia só modelos aprovados, preenchidos com seu perfil de candidato e o anúncio. Editar um modelo retira a aprovação.",
      names: { "first-contact": "Primeiro contato", "viewing-confirmation": "Confirmação de visita", "documents-follow": "Documentos a seguir", decline: "Não tenho mais interesse" },
      when: {
        "first-contact": "Enviado uma vez a um anúncio salvo que atende a todos os seus critérios.",
        "viewing-confirmation": "Enviado depois que você confirma no anúncio um dos horários de visita propostos.",
        "documents-follow": "Enviado quando um proprietário pede documentos. Só os anuncia: documentos saem apenas por um link que você aprova.",
        decline: "Enviado quando você marca como “Descartado” um anúncio já contatado."
      },
      approved: (d, v) => `Aprovado em ${d} · versão ${v}`, notApproved: v => `Não aprovado · versão ${v}`,
      placeholders: "Marcadores (clique para inserir)", save: "Salvar texto", saved: "Salvo", preview: "Prévia", approve: "Aprovar esta versão", withdraw: "Retirar aprovação",
      saveFirst: "Salve o texto primeiro e depois aprove.", discardConfirm: "Descartar as alterações não salvas neste texto?", previewExample: "Prévia com um anúncio de exemplo e seu perfil de candidato.",
      missing: list => `Falta para enviar: ${list}. Preencha em Sobre mim ou nas Configurações; até lá a rotina pula este modelo.`,
      failed: "Não foi possível salvar", netFail: "Servidor inacessível.", changedMeanwhile: "O modelo mudou nesse meio tempo; reabra as Configurações.",
      sendOn: "Envio ligado", sendPaused: "Envio pausado", sentToday: (n, cap) => `${n}/${cap} hoje`,
      pauseTip: "Clique para pausar na hora as mensagens da rotina.", resumeTip: "Clique para permitir que a rotina volte a enviar modelos aprovados.",
      resumeConfirm: "Retomar o envio? A partir da próxima execução a rotina pode enviar modelos aprovados de novo.", pauseFail: "Não foi possível mudar o botão de pausa.",
      viewingsH: "Propostas de visita", proposed: "Visita proposta", pickTime: "Escolha um horário", confirmTime: "Confirmar este horário", decline: "Recusar",
      noTimes: "Nenhum horário proposto. Responda você mesmo ao proprietário.", confirmed: t => `Visita confirmada: ${t}`, confirmationSent: d => `Confirmação enviada em ${d}.`,
      confirmationPending: "A rotina envia a confirmação na próxima execução, se o modelo estiver aprovado.",
      declined: "Recusado. Nada foi enviado; responda ao proprietário se quiser.", cancelled: "Cancelado: o proprietário desistiu.",
      me: "Eu (rotina)", templateTag: (name, v, lang) => `Modelo: ${name}${v == null ? "" : ` · v${v}`} · ${lang.toUpperCase()}`,
      intents: { "viewing-invite": "Convite para visita", "documents-request": "Pedido de documentos", rejection: "Recusa", question: "Pergunta", other: "Outro" },
      upSent: "Mensagem enviada", upReply: "Resposta", upSkipped: "Ignorado (já em contato)", upExpired: "Expirado, talvez enviado: verificar", viewingBadge: "Confirmar visita",
      claimOpen: "A confirmação está sendo enviada agora. Tente novamente em um minuto."
    }
  };

  // A viewing time in Berlin time for the page: "Tue 27 Oct, 18:00" in the page language.
  const validDate = iso => { const d = typeof iso === "string" || typeof iso === "number" ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
  const timesOf = v => Array.isArray(v && v.proposedTimes) ? v.proposedTimes.filter(x => typeof x === "string") : [];
  const hasPendingProposal = c => ((c && c.viewings) || []).some(v => v && v.status === "pending" && timesOf(v).length);
  const fmtTime = (iso, lang) => { const d = validDate(iso); return d ? fmtTimeOf(d, lang) : ""; };
  const fmtTimeOf = (d, lang) => new Intl.DateTimeFormat((L[lang] || L.en).locale, { timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

  // The header switch: its label, tooltip and whether it shows the paused state.
  function switchState(status, lang) {
    const t = L[lang] || L.en;
    if (!status || !status.enabled) return null;
    const paused = !!status.paused;
    return { paused, label: `${paused ? t.sendPaused : t.sendOn} · ${t.sentToday(status.today.used, status.today.cap)}`, title: paused ? t.resumeTip : t.pauseTip };
  }

  // The tag under a message: the template for an outgoing one, the intent for an incoming one, or null.
  function messageTag(m, lang) {
    const t = L[lang] || L.en;
    if (m.dir === "out" && m.templateId && t.names[m.templateId]) return t.templateTag(t.names[m.templateId], m.templateVersion, m.lang || "de");
    if (m.dir === "in" && m.intent && t.intents[m.intent]) return t.intents[m.intent];
    return null;
  }

  // What the viewing block says about one proposal (DOM-free, for the tests).
  function viewingText(v, lang) {
    const t = L[lang] || L.en;
    if (v.status === "pending") return timesOf(v).length ? t.proposed : t.noTimes;
    if (v.status === "confirmed") {
      const sent = validDate(v.confirmationSentAt);
      return t.confirmed(fmtTime(v.time, lang)).trim() + " " + (sent ? t.confirmationSent(sent.toLocaleDateString(t.locale, { timeZone: "Europe/Berlin" })) : t.confirmationPending);
    }
    if (v.status === "declined") return t.declined;
    return t.cancelled; // cancelled and any unknown status
  }

  // Newest proposal first.
  const sortViewings = list => [...(list || [])].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  // The text under a failed viewing request: a held confirmation claim and a dead connection get their own words, else the server's error.
  function viewingError(r, lang) {
    const t = L[lang] || L.en;
    if (r.status === 0) return t.netFail;
    const j = r.json || {};
    if (j.reason === "claim-open") return t.claimOpen;
    return j.error ? String(j.error) : `${t.failed} (${r.status})`;
  }
  // Update-log entry of the outreach routine: the tag text and the muted note after the link; null for the older types.
  function updateParts(e, lang) {
    const t = L[lang] || L.en;
    if (e.type === "sent") return { label: t.upSent, note: t.names[e.template] || "" };
    if (e.type === "skipped") return { label: e.reason === "expired" ? t.upExpired : t.upSkipped, note: t.names[e.template] || "" };
    if (e.type === "reply") return { label: t.upReply, note: t.intents[e.intent] || "" };
    return null;
  }

  const shared = { timesOf, hasPendingProposal, TEMPLATE_IDS, TEMPLATE_LANGS, INTENTS, L, fmtTime, switchState, messageTag, viewingText, sortViewings, viewingError, updateParts };
  if (typeof window === "undefined") { module.exports = shared; return; }
  // ---------- page ----------
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === "text") e.textContent = v; else if (k.startsWith("on")) e[k] = v; else if (v === true) e.setAttribute(k, ""); else if (v !== false && v != null) e.setAttribute(k, v); }
    kids.flat().forEach(k => k && e.append(k));
    return e;
  };
  // Every request goes uncached; a dead connection answers { status: 0 } instead of throwing.
  async function api(method, url, body) {
    try {
      const r = await fetch(url, { method, cache: "no-store", headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
    } catch (e) { return { ok: false, status: 0, json: {} }; }
  }
  // What went wrong, for the line under a button: the server's detail lines, else its reason code, else the status.
  const problem = (t, r) => r.status === 0 ? t.netFail : r.json.details && r.json.details.length ? r.json.details.map(String) : [`${t.failed} (${r.json.error || r.status})`];
  const approvedDate = (iso, t) => new Date(iso).toLocaleDateString(t.locale, { timeZone: "Europe/Berlin" });

  function mountTemplates(host, { lang }) {
    const t = L[lang] || L.en;
    const profile = window.FlatHunt && window.FlatHunt.profile();
    const startLang = profile && profile.outreach && TEMPLATE_LANGS.includes(profile.outreach.language) ? profile.outreach.language : "de";
    let data = null;
    const cards = [];
    const list = el("div", { class: "tpl-list" });
    const top = el("p", { class: "err", role: "alert" });
    host.replaceChildren(el("h4", { class: "tpl-h", text: t.templatesH }), el("p", { class: "hint", text: t.templatesIntro }), top, list);

    // The server's view after any failed call: the saved texts, versions and approvals (a failed edit restores the old version unapproved).
    async function reload() {
      const r = await api("GET", "/api/templates");
      if (!r.ok || !r.json.templates) return false;
      data = r.json;
      cards.forEach(c => c.sync());
      return true;
    }

    function card(id) {
      let cur = startLang, flash = null;
      const tpl = () => data.templates[id][cur];
      const chip = el("span", { class: "tpl-chip" });
      const tabs = TEMPLATE_LANGS.map(l => el("button", { type: "button", class: "chip", text: l.toUpperCase(), "aria-pressed": String(l === cur), onclick: () => switchTo(l) }));
      const ta = el("textarea", { rows: 10, maxlength: 2000, spellcheck: "false", "aria-label": t.names[id] });
      const tokens = el("div", { class: "tpl-tokens", role: "group", "aria-label": t.placeholders });
      const err = el("div", { class: "err tpl-err", role: "alert" });
      const out = el("div", { class: "tpl-out" });
      const bSave = el("button", { type: "button", class: "vu-btn", text: t.save, onclick: save });
      const bPrev = el("button", { type: "button", class: "vu-btn", text: t.preview, onclick: preview });
      const bOk = el("button", { type: "button", class: "vu-btn primary", text: t.approve, onclick: approve });
      const bNo = el("button", { type: "button", class: "vu-btn danger", text: t.withdraw, onclick: withdraw });
      const saved = el("span", { class: "vu-saved", role: "status" });
      const busy = on => [bSave, bPrev, bOk, bNo].forEach(b => { b.disabled = on || b.dataset.off === "1"; });
      const setOff = (b, off, title) => { b.dataset.off = off ? "1" : ""; b.disabled = off; if (title) b.title = title; else b.removeAttribute("title"); };
      const dirty = () => ta.value !== tpl().body;
      const root = el("section", { class: "tpl-card" },
        el("h5", { text: t.names[id] }), el("p", { class: "hint", text: t.when[id] }),
        el("div", { class: "tpl-bar" }, chip, el("div", { class: "tpl-tabs", role: "group" }, tabs)),
        ta, el("p", { class: "hint", text: t.placeholders }), tokens, err,
        el("div", { class: "tpl-acts" }, bSave, bPrev, bOk, bNo, saved), out);

      function sync() {
        const x = tpl();
        if (!ta.dataset.touched) ta.value = x.body;
        const ok = !!x.approvedAt;
        chip.textContent = ok ? t.approved(approvedDate(x.approvedAt, t), x.version) : t.notApproved(x.version);
        chip.className = "tpl-chip " + (ok ? "good" : "warn");
        tabs.forEach((b, i) => b.setAttribute("aria-pressed", String(TEMPLATE_LANGS[i] === cur)));
        setOff(bOk, dirty() || ok, dirty() ? t.saveFirst : null);
        setOff(bNo, !ok);
        bNo.hidden = !ok;
      }
      const lines = (target, msgs) => { target.replaceChildren(...[].concat(msgs).map(m => el("div", { text: m }))); };
      const clearMsgs = () => { err.replaceChildren(); out.replaceChildren(); saved.textContent = ""; };

      tokens.append(...(data.placeholders[id] || []).map(n => el("button", { type: "button", class: "chip", text: "{" + n + "}", onclick: () => {
        const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
        ta.setRangeText("{" + n + "}", s, e, "end"); ta.focus(); ta.dispatchEvent(new Event("input"));
      } })));
      ta.addEventListener("input", () => { ta.dataset.touched = "1"; sync(); });

      function switchTo(l) {
        if (l === cur) return;
        if (dirty() && !confirm(t.discardConfirm)) return;
        cur = l; ta.dataset.touched = ""; clearMsgs(); sync();
      }
      async function call(fn) {
        busy(true); ta.disabled = true; clearMsgs();
        try { await fn(); } finally { ta.disabled = false; busy(false); sync(); }
      }
      const fail = async r => { lines(err, r.json && r.json.error === "version-changed" ? t.changedMeanwhile : problem(t, r)); if (!(await reload())) lines(err, t.netFail); };
      function save() {
        return call(async () => {
          const r = await api("PUT", `/api/templates/${id}/${cur}`, { body: ta.value });
          if (!r.ok) return fail(r);
          data.templates[id][cur] = r.json.template; ta.dataset.touched = "";
          saved.textContent = t.saved; clearTimeout(flash); flash = setTimeout(() => { saved.textContent = ""; }, 2000);
        });
      }
      function preview() {
        return call(async () => {
          const r = await api("POST", "/api/templates/preview", { id, lang: cur, body: ta.value });
          if (!r.ok) return fail(r);
          out.append(el("pre", { class: "tpl-preview", text: r.json.text }));
          if (r.json.example) out.append(el("p", { class: "hint", text: t.previewExample }));
          if (r.json.missing && r.json.missing.length) out.append(el("p", { class: "tpl-warn", text: t.missing(r.json.missing.map(n => "{" + n + "}").join(", ")) }));
        });
      }
      function approve() {
        return call(async () => {
          const r = await api("POST", `/api/templates/${id}/${cur}/approve`, { version: tpl().version });
          if (!r.ok) return fail(r);
          data.templates[id][cur] = r.json.template;
        });
      }
      function withdraw() {
        return call(async () => {
          const r = await api("DELETE", `/api/templates/${id}/${cur}/approve`);
          if (!r.ok) return fail(r);
          data.templates[id][cur] = r.json.template;
        });
      }
      return { root, sync };
    }

    (async () => {
      if (!(await reload())) { top.textContent = t.netFail; return; }
      for (const id of TEMPLATE_IDS) { const c = card(id); cards.push(c); list.append(c.root); c.sync(); }
    })();
  }

  // The header pause switch. status comes from GET /api/outreach/status; null state hides it (outreach off).
  function headerSwitch(host, { lang, status, onChanged }) {
    const t = L[lang] || L.en, s = switchState(status, lang);
    host.hidden = !s;
    if (!s) { host.replaceChildren(); host.onclick = null; return; }
    const word = s.paused ? t.sendPaused : t.sendOn;
    const draw = (full, short, role) => host.replaceChildren(el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "lg", text: full, role }), el("span", { class: "sh", text: short, role }));
    draw(s.label, `${word} · ${status.today.used}/${status.today.cap}`);
    host.className = "chip sendsw " + (s.paused ? "paused" : "on");
    host.title = s.title; host.disabled = false;
    host.setAttribute("aria-checked", String(!s.paused));
    host.setAttribute("aria-label", s.label);
    host.onclick = async () => {
      if (host.disabled) return;
      if (s.paused && !confirm(t.resumeConfirm)) return;
      host.disabled = true; host.dataset.busy = "1";
      const r = await api("PUT", "/api/outreach/pause", { paused: !s.paused });
      delete host.dataset.busy;
      if (r.ok) { onChanged && onChanged(); return; }
      draw(t.pauseFail, t.pauseFail, "status");
      setTimeout(() => { if (onChanged) onChanged(); else headerSwitch(host, { lang, status, onChanged }); }, 4000);
    };
  }

  // Errors of failed viewing requests survive the reload that follows them: shown once when the block is drawn again.
  const viewingErrors = new Map();

  // The viewing proposals of one listing: pick a time and confirm, or decline. After a request the page reloads (onChanged).
  function viewings(host, listing, { lang, onChanged }) {
    const t = L[lang] || L.en;
    const items = sortViewings(listing.viewings);
    for (const k of [...viewingErrors.keys()]) if (!items.some(v => v.id === k)) viewingErrors.delete(k);
    host.hidden = !items.length;
    if (!items.length) { host.replaceChildren(); return; }
    const card = v => {
      const err = el("p", { class: "err vw-err", role: "alert" });
      const shown = viewingErrors.get(v.id);
      viewingErrors.delete(v.id);
      if (shown) setTimeout(() => { err.textContent = shown; }, 0); // inserted empty first so the live region announces it
      const btns = el("div", { class: "vu-btns" });
      const sendReq = async (action, body) => {
        const all = [...btns.querySelectorAll("button")];
        all.forEach(b => { b.disabled = true; });
        err.textContent = "";
        const r = await api("POST", `/api/listings/${encodeURIComponent(listing.id)}/viewings/${encodeURIComponent(v.id)}/${action}`, body);
        const reload = async () => { try { if (onChanged) await onChanged(); } catch (e) { all.forEach(b => { b.disabled = false; }); } };
        if (r.ok) { await reload(); all.forEach(b => { if (b.isConnected) b.disabled = b.dataset.needsPick === "1"; }); return; }
        const msg = viewingError(r, lang);
        err.textContent = msg;
        if (r.status !== 0 && onChanged) { viewingErrors.set(v.id, msg); await reload(); } // reload to show what the server holds now
        all.forEach(b => { if (b.isConnected) b.disabled = b.dataset.needsPick === "1"; });
      };
      const decline = () => el("button", { type: "button", class: "vu-btn danger", text: t.decline, onclick: () => sendReq("decline") });
      const root = el("div", { class: "vw-item " + v.status });
      if (v.status === "pending" && timesOf(v).length) {
        const name = "vw-" + v.id;
        let picked = null;
        const ok = el("button", { type: "button", class: "vu-btn primary", text: t.confirmTime, disabled: true, "data-needs-pick": "1", onclick: () => sendReq("confirm", { time: picked }) });
        const set = el("fieldset", { class: "vw-times" }, el("legend", { text: t.pickTime }),
          timesOf(v).map(time => el("label", { class: "vw-time" },
            el("input", { type: "radio", name, value: time, onchange: () => { picked = time; ok.dataset.needsPick = ""; ok.disabled = false; } }),
            el("span", { text: fmtTime(time, lang) }))));
        btns.append(ok, decline());
        root.append(el("p", { class: "vw-line", text: t.proposed }), set, btns, err);
      } else if (v.status === "pending") {
        btns.append(decline());
        root.append(el("p", { class: "vw-line", text: t.noTimes }), btns, err);
      } else {
        root.append(el("p", { class: "vw-line", text: viewingText(v, lang) }));
        if (v.status === "confirmed" && !v.confirmationSentAt) { btns.append(decline()); root.append(btns); }
        root.append(err);
      }
      return root;
    };
    host.replaceChildren(el("h4", { class: "vw-h", text: t.viewingsH }), ...items.map(card));
  }

  window.OutreachUI = { ...shared, mountTemplates, headerSwitch, viewings };
})();
