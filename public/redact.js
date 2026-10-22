// public/redact.js — redaction helper: render a vault document to canvases, let the owner draw black boxes over
// sensitive numbers and save a flattened copy (pages → JPEG → image-only PDF) in place of the original.
(function () {
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const PDFJS_SRI = "sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==";
  const WORKER_SRI = "sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw==";
  const MAX_PAGES = 20;
  const MAX_BYTES = 10 * 1024 * 1024; // same limit as uploads
  const A4 = [595.28, 841.89];
  const MAX_SCALE = 2; // canvas pixels per PDF point, at most
  const MAX_SIDE = 4096; // longest canvas side in pixels (browsers refuse or blank larger canvases)
  const PIXEL_BUDGET = 60e6; // all page canvases together (phone memory)

  const L = {
    en: {
      title: "Cover sensitive details",
      hint: "Draw black boxes over the tax ID (Steuer-ID), the social-security number (Sozialversicherungsnummer), bank details (IBAN) and anything else the landlord does not need. The saved version replaces the stored file; the covered parts cannot be restored.",
      loading: "Loading the document…", viewerFail: "The PDF viewer could not be loaded. Check the connection and try again.",
      loadFail: "The document could not be loaded.", password: "This PDF is password-protected. Remove the password, upload it again and then cover the details.",
      unreadable: "This file could not be read as a PDF or image.", tooLarge: "A page is too large for this browser to display. Try a smaller scan or a computer with more memory.", tooMany: n => `This PDF has ${n} pages; the helper handles at most ${MAX_PAGES}. Upload only the pages the landlord needs.`,
      page: (i, n) => `Page ${i} of ${n}`, boxes: n => n === 1 ? "1 box" : `${n} boxes`,
      undo: "Undo last box", clear: "Clear page", cancel: "Cancel", save: "Save redacted copy", saving: "Saving…",
      scroll: "Scroll", draw: "Draw boxes",
      confirm: "The original is replaced and cannot be restored. Save the redacted copy?",
      tooBig: "The redacted copy is larger than 10 MB. Upload fewer pages and try again.",
      saveFail: "Could not save the redacted copy.", netFail: "Could not reach the server."
    },
    de: {
      title: "Sensible Angaben abdecken",
      hint: "Ziehe schwarze Kästen über die Steuer-ID, die Sozialversicherungsnummer, Bankdaten (IBAN) und alles andere, was der Vermieter nicht braucht. Die gespeicherte Fassung ersetzt die abgelegte Datei; abgedeckte Stellen lassen sich nicht wiederherstellen.",
      loading: "Dokument wird geladen…", viewerFail: "Der PDF-Betrachter konnte nicht geladen werden. Prüfe die Verbindung und versuche es erneut.",
      loadFail: "Das Dokument konnte nicht geladen werden.", password: "Dieses PDF ist passwortgeschützt. Entferne das Passwort, lade es erneut hoch und decke dann die Angaben ab.",
      unreadable: "Diese Datei konnte nicht als PDF oder Bild gelesen werden.", tooLarge: "Eine Seite ist zu groß, um sie in diesem Browser anzuzeigen. Versuche einen kleineren Scan oder einen Rechner mit mehr Arbeitsspeicher.", tooMany: n => `Dieses PDF hat ${n} Seiten; die Hilfe verarbeitet höchstens ${MAX_PAGES}. Lade nur die Seiten hoch, die der Vermieter braucht.`,
      page: (i, n) => `Seite ${i} von ${n}`, boxes: n => n === 1 ? "1 Kasten" : `${n} Kästen`,
      undo: "Letzten Kasten entfernen", clear: "Seite leeren", cancel: "Abbrechen", save: "Geschwärzte Kopie speichern", saving: "Wird gespeichert…",
      scroll: "Blättern", draw: "Kästen zeichnen",
      confirm: "Das Original wird ersetzt und lässt sich nicht wiederherstellen. Geschwärzte Kopie speichern?",
      tooBig: "Die geschwärzte Kopie ist größer als 10 MB. Lade weniger Seiten hoch und versuche es erneut.",
      saveFail: "Die geschwärzte Kopie konnte nicht gespeichert werden.", netFail: "Der Server ist nicht erreichbar."
    },
    pt: {
      title: "Cobrir dados sensíveis",
      hint: "Desenhe caixas pretas sobre o número fiscal (Steuer-ID), o número da previdência social (Sozialversicherungsnummer), os dados bancários (IBAN) e tudo o que o locador não precisa ver. A versão salva substitui o arquivo guardado; as partes cobertas não podem ser recuperadas.",
      loading: "Carregando o documento…", viewerFail: "Não foi possível carregar o visualizador de PDF. Verifique a conexão e tente novamente.",
      loadFail: "Não foi possível carregar o documento.", password: "Este PDF é protegido por senha. Remova a senha, envie-o novamente e depois cubra os dados.",
      unreadable: "Não foi possível ler este arquivo como PDF ou imagem.", tooLarge: "Uma página é grande demais para ser exibida neste navegador. Tente um escaneamento menor ou um computador com mais memória.", tooMany: n => `Este PDF tem ${n} páginas; o assistente processa no máximo ${MAX_PAGES}. Envie só as páginas de que o locador precisa.`,
      page: (i, n) => `Página ${i} de ${n}`, boxes: n => n === 1 ? "1 caixa" : `${n} caixas`,
      undo: "Desfazer última caixa", clear: "Limpar página", cancel: "Cancelar", save: "Salvar cópia tarjada", saving: "Salvando…",
      scroll: "Rolar", draw: "Desenhar caixas",
      confirm: "O original será substituído e não poderá ser recuperado. Salvar a cópia tarjada?",
      tooBig: "A cópia tarjada tem mais de 10 MB. Envie menos páginas e tente novamente.",
      saveFail: "Não foi possível salvar a cópia tarjada.", netFail: "Não foi possível acessar o servidor."
    }
  };

  // ---------- pure helpers (tested in Node) ----------
  // pdf.js options. isEvalSupported: false — pdf.js 3.x must not compile font code with eval (CVE-2024-4367).
  const pdfOptions = data => ({ data, isEvalSupported: false, enableXfa: false });

  // sizes: [{ width, height }] at scale 1 → one render scale per page: at most maxScale, longest side at most maxSide
  // pixels, and all pages together within budget pixels (every scale reduced by the same factor when over).
  function pageScales(sizes, { maxScale = MAX_SCALE, maxSide = MAX_SIDE, budget = PIXEL_BUDGET } = {}) {
    const scales = sizes.map(s => Math.min(maxScale, maxSide / Math.max(s.width, s.height) * (1 - 1e-9)));
    const total = sizes.reduce((n, s, i) => n + Math.ceil(s.width * scales[i]) * Math.ceil(s.height * scales[i]), 0);
    if (total <= budget) return scales;
    const k = Math.sqrt(budget / total) * 0.995; // a little under, so rounding the canvas up stays inside
    return scales.map(x => x * k);
  }

  // Decode size for an image whose longest side exceeds maxSide (null when it fits).
  function decodeSize(width, height, maxSide = MAX_SIDE) {
    const long = Math.max(width, height);
    if (long <= maxSide) return null;
    const k = maxSide / long;
    return { resizeWidth: Math.max(1, Math.floor(width * k)), resizeHeight: Math.max(1, Math.floor(height * k)) };
  }

  // A box rounded outward to whole pixels, so antialiased edges cannot leave a sliver of the covered content.
  const outward = b => {
    const x = Math.floor(b.x), y = Math.floor(b.y);
    return { x, y, w: Math.ceil(b.x + b.w) - x, h: Math.ceil(b.y + b.h) - y };
  };

  if (typeof window === "undefined") { module.exports = { pdfOptions, pageScales, decodeSize, outward, L, MAX_SIDE, PIXEL_BUDGET }; return; }

  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const btn = (txt, cls, onclick) => { const b = el("button", cls || "", txt); b.type = "button"; b.onclick = onclick; return b; };

  // ---------- pdf.js, loaded on first use, both files checked against their SRI hashes ----------
  let pdfjsReady = null;
  function loadPdfJs() {
    if (!pdfjsReady) {
      pdfjsReady = (async () => {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = PDFJS + "pdf.min.js"; s.integrity = PDFJS_SRI; s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer";
          s.onload = resolve; s.onerror = () => { s.remove(); reject(new Error("pdf.js")); };
          document.head.append(s);
        });
        // The worker is fetched once, with the same integrity check, and started from a blob URL, so nothing unchecked
        // runs. The blob URL is deliberately never revoked: pdf.js starts a new worker from it for every document.
        const r = await fetch(PDFJS + "pdf.worker.min.js", { integrity: WORKER_SRI, mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
        if (!r.ok || !window.pdfjsLib) throw new Error("pdf.js worker");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([await r.text()], { type: "text/javascript" }));
        return window.pdfjsLib;
      })();
      pdfjsReady.catch(() => { pdfjsReady = null; });
    }
    return pdfjsReady;
  }

  class UserError extends Error {}

  const isPdf = u8 => u8.length > 4 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46;
  class TooLarge extends Error {}
  // A white canvas; TooLarge when the browser cannot allocate it.
  const whiteCanvas = (w, h) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.width === w && c.height === h ? c.getContext("2d") : null;
    if (!ctx) { c.width = c.height = 0; throw new TooLarge(); }
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    return c;
  };

  // → [{ canvas, pageWidth, pageHeight }]
  async function renderPages(t, bytes) {
    try { return await renderAll(t, bytes); }
    catch (e) { throw e instanceof TooLarge ? new UserError(t.tooLarge) : e; }
  }

  async function renderAll(t, bytes) {
    if (isPdf(bytes)) {
      let lib;
      try { lib = await loadPdfJs(); } catch (e) { throw new UserError(t.viewerFail); }
      const task = lib.getDocument(pdfOptions(bytes));
      let pdf;
      try { pdf = await task.promise; }
      catch (e) {
        task.destroy();
        throw new UserError(e && e.name === "PasswordException" ? t.password : t.unreadable);
      }
      const out = [];
      try {
        if (pdf.numPages > MAX_PAGES) throw new UserError(t.tooMany(pdf.numPages));
        const sizes = [];
        for (let i = 1; i <= pdf.numPages; i++) { const v = (await pdf.getPage(i)).getViewport({ scale: 1 }); sizes.push({ width: v.width, height: v.height }); }
        const scales = pageScales(sizes);
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const v = page.getViewport({ scale: scales[i - 1] });
          const canvas = whiteCanvas(Math.ceil(v.width), Math.ceil(v.height));
          out.push({ canvas, pageWidth: sizes[i - 1].width, pageHeight: sizes[i - 1].height });
          await page.render({ canvasContext: canvas.getContext("2d"), viewport: v }).promise;
          page.cleanup();
        }
        return out;
      } catch (e) {
        out.forEach(p => { p.canvas.width = p.canvas.height = 0; });
        throw e instanceof UserError || e instanceof TooLarge ? e : new UserError(t.unreadable);
      } finally { pdf.destroy(); }
    }
    // Image: one A4 page, portrait or landscape by aspect, image fitted inside 36 pt margins (as lib/pdf.js toPdf).
    // Large photos are decoded again at most MAX_SIDE pixels on the longest side.
    let img;
    const blob = new Blob([bytes]);
    try {
      img = await createImageBitmap(blob);
      const resize = decodeSize(img.width, img.height);
      if (resize) { img.close(); img = await createImageBitmap(blob, { ...resize, resizeQuality: "high" }); }
    } catch (e) { throw new UserError(t.unreadable); }
    const landscape = img.width > img.height;
    const [w, h] = landscape ? [A4[1], A4[0]] : A4;
    const fit = Math.min((w - 72) / img.width, (h - 72) / img.height);
    const [scale] = pageScales([{ width: w, height: h }]);
    let canvas;
    try { canvas = whiteCanvas(Math.round(w * scale), Math.round(h * scale)); } finally { if (!canvas) img.close(); }
    const dw = img.width * fit * scale, dh = img.height * fit * scale;
    const ctx = canvas.getContext("2d"); ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    img.close();
    return [{ canvas, pageWidth: w, pageHeight: h }];
  }

  const toJpeg = (canvas, q) => new Promise((resolve, reject) => canvas.toBlob(b => b ? b.arrayBuffer().then(a => resolve(new Uint8Array(a)), reject) : reject(new Error("toBlob")), "image/jpeg", q));

  // Flatten every page with its boxes burned in; lower the JPEG quality if the result would exceed the upload limit.
  async function flatten(pages) {
    for (const q of [0.92, 0.8, 0.65]) {
      const jpegs = [];
      for (const p of pages) {
        const c = whiteCanvas(p.canvas.width, p.canvas.height), ctx = c.getContext("2d");
        ctx.drawImage(p.canvas, 0, 0);
        ctx.fillStyle = "#000";
        p.boxes.map(outward).forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h));
        jpegs.push({ jpeg: await toJpeg(c, q), width: c.width, height: c.height, pageWidth: p.pageWidth, pageHeight: p.pageHeight });
        c.width = c.height = 0;
      }
      const pdf = window.ImagePdf.fromJpegs(jpegs);
      if (pdf.length <= MAX_BYTES) return pdf;
    }
    return null;
  }

  function open({ doc, lang, onSaved } = {}) {
    const t = L[lang] || L.en;
    const dlg = el("dialog", "sx rd");
    dlg.setAttribute("aria-labelledby", "rd-title");
    const form = el("form"); form.method = "dialog";
    const head = el("div", "sxhead");
    const h2 = el("h2", null, t.title); h2.id = "rd-title";
    head.append(h2, el("p", "hint", t.hint));
    const body = el("div", "sxbody rd-body");
    const status = el("p", "hint", t.loading); status.setAttribute("aria-live", "polite");
    body.append(status);
    const err = el("p", "err"); err.setAttribute("role", "alert");
    const count = el("span", "rd-count");
    const undoB = btn(t.undo, "", () => undo());
    const clearB = btn(t.clear, "", () => clearPage());
    const modeB = btn(t.scroll, "rd-mode", () => setScroll(!scrollMode));
    const cancelB = btn(t.cancel, "", () => dlg.close());
    const saveB = btn(t.save, "primary", () => save());
    const tools = el("div", "bar rd-tools"); tools.append(undoB, clearB, modeB, count);
    const bar = el("div", "bar"); bar.append(cancelB, el("span"), saveB);
    form.append(head, body, el("div", "sxfoot", null));
    form.lastChild.append(err, tools, bar);
    dlg.append(form);
    document.body.append(dlg);

    let pages = [], history = [], active = 0, busy = false, scrollMode = false, closed = false;
    const total = () => pages.reduce((n, p) => n + p.boxes.length, 0);
    const refresh = () => {
      const n = total();
      count.textContent = pages.length ? t.boxes(n) : "";
      undoB.disabled = !history.length || busy;
      clearB.disabled = !(pages[active] && pages[active].boxes.length) || busy;
      saveB.disabled = !n || busy;
      cancelB.disabled = busy;
      modeB.disabled = !pages.length;
      pages.forEach((p, i) => p.wrap.classList.toggle("active", i === active && pages.length > 1));
    };
    refresh();

    const paint = p => {
      const ctx = p.overlay.getContext("2d"), k = p.overlay.width / p.canvas.width;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, p.overlay.width, p.overlay.height);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.fillStyle = "#000";
      p.boxes.forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h));
      if (p.preview) {
        const b = p.preview;
        ctx.fillStyle = "rgba(0, 0, 0, .55)"; ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = "#e5484d"; ctx.lineWidth = 2 / k; ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
    };
    function undo() {
      const last = history.pop(); if (!last) return;
      const p = pages[last.page]; p.boxes.splice(p.boxes.lastIndexOf(last.box), 1);
      active = last.page; paint(p); refresh();
    }
    function clearPage() {
      const p = pages[active]; if (!p) return;
      history = history.filter(h => h.page !== active); p.boxes = []; paint(p); refresh();
    }
    function setScroll(on) {
      scrollMode = on;
      modeB.textContent = on ? t.draw : t.scroll;
      modeB.setAttribute("aria-pressed", String(on));
      body.classList.toggle("scrolling", on);
    }

    function attach(p, index) {
      const ov = p.overlay;
      let start = null, id = null;
      const at = e => {
        const r = ov.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width * p.canvas.width, y = (e.clientY - r.top) / r.height * p.canvas.height;
        return { x: Math.max(0, Math.min(p.canvas.width, x)), y: Math.max(0, Math.min(p.canvas.height, y)) };
      };
      const rect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
      ov.addEventListener("pointerdown", e => {
        if (busy || id !== null || (scrollMode && e.pointerType !== "mouse") || (e.pointerType === "mouse" && e.button !== 0)) return;
        e.preventDefault();
        id = e.pointerId; start = at(e); active = index;
        try { ov.setPointerCapture(id); } catch (x) { /* already released */ }
        p.preview = rect(start, start); paint(p); refresh();
      });
      ov.addEventListener("pointermove", e => {
        if (e.pointerId !== id) return;
        e.preventDefault();
        p.preview = rect(start, at(e)); paint(p);
      });
      const end = keep => e => {
        if (e.pointerId !== id) return;
        const b = keep ? rect(start, at(e)) : null;
        id = null; start = null; p.preview = null;
        if (b && b.w >= 4 && b.h >= 4) { p.boxes.push(b); history.push({ page: index, box: b }); }
        paint(p); refresh();
      };
      ov.addEventListener("pointerup", end(true));
      ov.addEventListener("pointercancel", end(false));
    }

    async function save() {
      if (busy || !total()) return;
      if (!confirm(t.confirm)) return;
      busy = true; err.textContent = ""; saveB.textContent = t.saving; refresh();
      try {
        let pdf;
        try { pdf = await flatten(pages); } catch (e) { throw new UserError(t.saveFail); }
        if (!pdf) throw new UserError(t.tooBig);
        let r;
        try { r = await fetch("/api/vault/" + encodeURIComponent(doc.id) + "/replace", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: pdf, cache: "no-store" }); }
        catch (e) { throw new UserError(t.netFail); }
        if (!r.ok) throw new UserError(t.saveFail);
        let saved = doc;
        try { const j = await r.json(); if (j && j.doc) saved = j.doc; } catch (e) { /* keep doc */ }
        busy = false; dlg.close();
        if (typeof onSaved === "function") onSaved(saved);
      } catch (e) {
        busy = false; saveB.textContent = t.save;
        err.textContent = e instanceof UserError ? e.message : t.saveFail;
        refresh();
      }
    }

    // Escape and Cancel discard everything; while saving the dialog stays open.
    dlg.addEventListener("cancel", e => { if (busy) e.preventDefault(); });
    dlg.addEventListener("close", () => {
      closed = true;
      pages.forEach(p => { p.canvas.width = p.canvas.height = 0; p.overlay.width = p.overlay.height = 0; });
      pages = []; history = [];
      dlg.remove();
    });
    dlg.showModal();
    cancelB.focus();

    (async () => {
      try {
        let r;
        try { r = await fetch("/api/vault/" + encodeURIComponent(doc.id), { cache: "no-store" }); }
        catch (e) { throw new UserError(t.netFail); }
        if (!r.ok) throw new UserError(t.loadFail);
        const bytes = new Uint8Array(await r.arrayBuffer());
        const rendered = await renderPages(t, bytes);
        if (closed) return;
        const list = el("div", "rd-pages");
        pages = rendered.map((p, i) => {
          const wrap = el("figure", "rd-page");
          const stack = el("div", "rd-stack");
          stack.style.aspectRatio = `${p.canvas.width} / ${p.canvas.height}`;
          p.canvas.className = "rd-base";
          // The overlay only shows the boxes, so it runs at half resolution; boxes are kept in base-canvas pixels.
          const overlay = el("canvas", "rd-overlay");
          overlay.width = Math.ceil(p.canvas.width / 2); overlay.height = Math.ceil(p.canvas.height / 2);
          stack.append(p.canvas, overlay);
          wrap.append(stack);
          if (rendered.length > 1) wrap.append(el("figcaption", "hint", t.page(i + 1, rendered.length)));
          list.append(wrap);
          return { ...p, overlay, wrap, boxes: [], preview: null };
        });
        pages.forEach(attach);
        body.replaceChildren(list);
        setScroll(false);
        refresh();
      } catch (e) {
        if (closed) return;
        status.textContent = "";
        err.textContent = e instanceof UserError ? e.message : t.loadFail;
      }
    })();
    return dlg;
  }

  window.Redact = { open, L };
})();
