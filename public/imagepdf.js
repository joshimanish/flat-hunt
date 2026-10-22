// public/imagepdf.js — builds a PDF from JPEG page images (browser + Node). Used by the redaction helper: the
// covered text is gone because each page is only a picture.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ImagePdf = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const enc = s => new TextEncoder().encode(s);

  // pages: [{ jpeg: Uint8Array, width, height (pixels), pageWidth, pageHeight (points) }] → Uint8Array (PDF 1.4)
  function fromJpegs(pages) {
    if (!Array.isArray(pages) || !pages.length) throw new Error("at least one page expected");
    const chunks = [], offsets = [];
    let length = 0;
    const push = b => { chunks.push(b); length += b.length; };
    const obj = (n, body, stream) => {
      offsets[n] = length;
      push(enc(`${n} 0 obj\n${body}\n`));
      if (stream) { push(enc("stream\n")); push(stream); push(enc("\nendstream\n")); }
      push(enc("endobj\n"));
    };
    const pageIds = pages.map((_, i) => 3 + i * 3);
    push(enc("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"));
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Kids [${pageIds.map(n => n + " 0 R").join(" ")}] /Count ${pages.length} >>`);
    pages.forEach((p, i) => {
      const n = pageIds[i], w = +p.pageWidth.toFixed(2), h = +p.pageHeight.toFixed(2);
      const content = enc(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
      obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
      obj(n + 1, `<< /Length ${content.length} >>`, content);
      obj(n + 2, `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
    });
    const count = 3 + pages.length * 3, xref = length;
    let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let n = 1; n < count; n++) table += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
    push(enc(table + `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  return { fromJpegs };
});
