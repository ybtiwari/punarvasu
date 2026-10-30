// RX-PDF-ON-DEMAND: a prescription is saved as text only (remedy, dose, notes, date). Its PDF is made here, on the clinic letterhead,
// only when someone asks for it — nothing is stored, so the prescription lists stay small. The same layout the Case Analyzer and the
// Repertory show on the screen. One identical copy in the public site and in the workspace (no build step) — change both together.
// Older prescriptions that still carry a stored PDF (pdfBase64) keep using it.
(function () {
  const CSS = `
#pvRxPdfStage { position: fixed; left: -10000px; top: 0; width: 720px; z-index: -1; }
#pvRxPdfStage, #pvRxPdfStage * { box-sizing: border-box; }
#pvRxPdfStage #rx-wrap {
  width: 720px; min-height: 950px; margin: 0;
  background: #fff; display: flex; flex-direction: column;
  font-family: 'EB Garamond', Georgia, serif; color: #1a1a18;
}
#pvRxPdfStage .rx-body { flex: 1; padding: 20px 32px 24px; }
#pvRxPdfStage .rx-clinic-header {
  background: linear-gradient(135deg, #1c2e50 0%, #2055a4 100%);
  color: #fff; padding: 20px 32px 16px; position: relative;
}
#pvRxPdfStage .rx-clinic-name { font-size: 22px; font-weight: 700; letter-spacing: 1px; }
#pvRxPdfStage .rx-clinic-tag  { font-size: 10px; color: rgba(255,255,255,0.6); letter-spacing: 2.5px; text-transform: uppercase; margin-top: 3px; }
#pvRxPdfStage .rx-doctor      { margin-top: 10px; font-size: 15px; font-weight: 600; color: #f0d080; }
#pvRxPdfStage .rx-qual        { font-size: 12px; color: rgba(255,255,255,0.72); font-style: italic; margin-top: 2px; }
#pvRxPdfStage .rx-hdr-date    { position: absolute; top: 20px; right: 28px; text-align: right; }
#pvRxPdfStage .rx-hdr-date strong { display: block; font-size: 13px; color: #fff; }
#pvRxPdfStage .rx-hdr-date span   { font-size: 11px; color: rgba(255,255,255,0.6); }
#pvRxPdfStage .rx-patient-sec { padding: 16px 32px 14px; border-bottom: 1px solid #e8e4dc; background: #fdf9f3; }
#pvRxPdfStage .rx-aum     { font-size: 30px; color: #8a5200; vertical-align: middle; }
#pvRxPdfStage .rx-blessing { font-size: 12px; color: #8a5200; font-style: italic; display: block; margin-top: 3px; }
#pvRxPdfStage .rx-pt-label { font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: #aaa; margin-top: 10px; margin-bottom: 2px; }
#pvRxPdfStage .rx-pt-name  { font-size: 20px; font-weight: 600; color: #1a1a18; }
#pvRxPdfStage .rx-sec-label { font-size: 10px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase;
  color: #2055a4; border-bottom: 1px solid #d0d8ee; padding-bottom: 5px; margin-bottom: 14px; }
#pvRxPdfStage .rx-symbol { font-size: 50px; color: #eef2fa; font-weight: 700; float: left; line-height: 1; margin: -4px 8px 0 -4px; }
#pvRxPdfStage .rx-table   { width: 100%; border-collapse: collapse; }
#pvRxPdfStage .rx-table th { font-size: 10px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase;
  color: #888; padding: 6px 10px; border-bottom: 2px solid #e8e4dc; text-align: left; background: #fafaf8; }
#pvRxPdfStage .rx-table td { padding: 10px; border-bottom: 1px solid #f0ede8; vertical-align: middle; }
#pvRxPdfStage .rx-table tr:last-child td { border-bottom: none; }
#pvRxPdfStage .rx-num  { text-align: center; width: 32px; color: #bbb; font-size: 12px; }
#pvRxPdfStage .rx-name { font-size: 15px; font-weight: 600; color: #1a1a18; }
#pvRxPdfStage .top-remedy td { background: #fffbf2; }
#pvRxPdfStage .top-remedy .rx-name { color: #8a5200; }
#pvRxPdfStage .rx-dose-box       { margin: 18px 0 0; border: 1.5px solid #c8c4bc; border-radius: 7px; overflow: hidden; }
#pvRxPdfStage .rx-dose-box-label { background: #f4f2ed; border-bottom: 1px solid #d8d4cc; padding: 7px 14px;
  font-size: 10px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; color: #2055a4; }
#pvRxPdfStage .rx-dose-box-inner { min-height: 100px; padding: 12px 14px; font-size: 14px; color: #1a1a18; line-height: 1.8; background: #fff; white-space: pre-wrap; word-break: break-word; }
#pvRxPdfStage .rx-notes .rx-dose-box-inner { min-height: 0; }
#pvRxPdfStage .rx-footer { background: #1c2e50; color: rgba(255,255,255,0.75); padding: 13px 32px;
  font-size: 11px; line-height: 1.8; text-align: center; }
#pvRxPdfStage .rx-footer .addr    { color: rgba(255,255,255,0.9); }
#pvRxPdfStage .rx-footer .contact { color: #90aacc; margin-top: 3px; }
#pvRxPdfStage .rx-disclaimer { padding: 8px 14px; background: #f8f6f2; border-top: 1px dashed #d8d4cc;
  font-size: 10px; color: #aaa; text-align: center; font-style: italic; }
`;
  const LIBS = [
    ['jspdf', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js', () => window.jspdf && window.jspdf.jsPDF],
    ['html2canvas', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => typeof window.html2canvas === 'function']
  ];
  const FONT = 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;0,700;1,400&display=swap';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); });
  }
  async function ready() {
    if (!document.querySelector('link[href*="EB+Garamond"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT; document.head.appendChild(l); }
    for (const [, src, has] of LIBS) if (!has()) { try { await loadScript(src); } catch (e) { console.error('[rx-pdf]', e.message); } }
  }
  function remedies(medicine) { return String(medicine || '').split(',').map(s => s.trim()).filter(Boolean); }
  function sheetHtml(name, e) {
    const rows = (remedies(e.medicine).length ? remedies(e.medicine) : ['—'])
      .map((r, i) => `<tr class="${i === 0 ? 'top-remedy' : ''}"><td class="rx-num">${i + 1}</td><td class="rx-name">${esc(r)}</td></tr>`).join('');
    return `<div id="rx-wrap">
    <div class="rx-clinic-header">
      <div class="rx-clinic-name">Punarvasu Clinic</div>
      <div class="rx-clinic-tag">Renewing Life. Restoring Hope.</div>
      <div class="rx-doctor">Dr. Yogeshwar Tiwari (BHMS)</div>
      <div class="rx-qual">Homeopathic Consultant &middot; Reg. No.: G-6424</div>
      <div class="rx-hdr-date"><strong>${esc(e.date || '')}</strong><span>Prescription</span></div>
    </div>
    <div class="rx-patient-sec">
      <span class="rx-aum">&#x211E;</span>
      <span class="rx-blessing">May the Divine grace restore your health and well-being</span>
      <div class="rx-pt-label">Patient</div>
      <div class="rx-pt-name">${esc(name || '(Patient not specified)')}</div>
    </div>
    <div class="rx-body">
      <div class="rx-sec-label">Prescription</div>
      <div class="rx-symbol">&#x211E;</div>
      <table class="rx-table"><thead><tr><th>#</th><th>Remedy</th></tr></thead><tbody>${rows}</tbody></table>
      <div style="clear:both"></div>
      <div class="rx-dose-box">
        <div class="rx-dose-box-label">Method &amp; Dose of Remedy</div>
        <div class="rx-dose-box-inner">${esc(e.dose || '—')}</div>
      </div>
      ${e.notes ? `<div class="rx-dose-box rx-notes"><div class="rx-dose-box-label">Notes</div><div class="rx-dose-box-inner">${esc(e.notes)}</div></div>` : ''}
    </div>
    <div class="rx-footer-group">
      <div class="rx-disclaimer">Computer Generated Prescription &mdash; does not require signature &nbsp;|&nbsp; Prepared using Repertorium Publicum</div>
      <div class="rx-footer">
        <div class="addr">307, Harvey Complex, Near Subhash Chowk, Gurukul Road, Memnagar, Ahmedabad &ndash; 380 052</div>
        <div class="contact">M: 9274791141 &nbsp;|&nbsp; Reg. No.: G-6424</div>
      </div>
    </div></div>`;
  }
  function fileName(name, e) {
    return 'Prescription_' + String(name || 'Patient').replace(/[^a-zA-Z0-9]+/g, '_') + '_' + String(e.date || '').replace(/[^a-zA-Z0-9]+/g, '_') + '.pdf';
  }
  function fromBase64(b64) {
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: 'application/pdf' });
  }
  async function letterhead(name, e) {
    if (!document.getElementById('pvRxPdfCss')) { const st = document.createElement('style'); st.id = 'pvRxPdfCss'; st.textContent = CSS; document.head.appendChild(st); }
    const stage = document.createElement('div');
    stage.id = 'pvRxPdfStage';
    stage.innerHTML = sheetHtml(name, e);
    document.body.appendChild(stage);
    try {
      if (document.fonts && document.fonts.load) { try { await document.fonts.load("600 20px 'EB Garamond'"); await document.fonts.ready; } catch (x) { /* fallback font is fine */ } }
      const canvas = await window.html2canvas(stage.querySelector('#rx-wrap'), { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const w = 190, m = 10, h = (canvas.height / canvas.width) * w;
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: [w + m * 2, h + m * 2], orientation: 'portrait' });
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', m, m, w, h);
      return pdf.output('blob');
    } finally { stage.remove(); }
  }
  function plain(name, e) {   // when the letterhead cannot be drawn (html2canvas missing): the same facts, plainly
    const doc = new window.jspdf.jsPDF();
    let y = 20;
    doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.text('Punarvasu Clinic', 15, y); y += 6;
    doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.text('Dr. Yogeshwar Tiwari, BHMS', 15, y); y += 8;
    doc.setDrawColor(200); doc.line(15, y, 195, y); y += 10;
    doc.setFontSize(12);
    doc.text('Patient: ' + (name || '—'), 15, y); y += 7;
    doc.text('Date: ' + (e.date || '') + (e.time ? '  ·  ' + e.time : ''), 15, y); y += 12;
    const block = (label, x, text, width) => { doc.setFont(undefined, 'bold'); doc.text(label, 15, y); doc.setFont(undefined, 'normal'); const l = doc.splitTextToSize(text || '—', width); doc.text(l, x, y); y += l.length * 6 + 4; };
    block('Medicine:', 40, e.medicine, 150);
    block('Dose:', 35, e.dose, 155);
    if (e.notes) { doc.setFont(undefined, 'bold'); doc.text('Notes:', 15, y); doc.setFont(undefined, 'normal'); y += 6; doc.text(doc.splitTextToSize(e.notes, 170), 15, y); }
    return doc.output('blob');
  }
  // e: the saved prescription {medicine, dose, notes, date, time, pdfBase64?}. Resolves to { blob, fileName }.
  async function make(e, name) {
    e = e || {};
    if (e.pdfBase64) return { blob: fromBase64(e.pdfBase64), fileName: e.pdfFileName || fileName(name, e) };
    await ready();
    if (!(window.jspdf && window.jspdf.jsPDF)) throw new Error('the PDF tool could not load - please check the internet connection and try again');
    let blob = null;
    if (typeof window.html2canvas === 'function') { try { blob = await letterhead(name, e); } catch (x) { console.error('[rx-pdf] letterhead failed, using the plain layout:', x); } }
    if (!blob) blob = plain(name, e);
    return { blob, fileName: fileName(name, e) };
  }
  // save the PDF to the device (works on phones, where a new tab after a wait is often blocked)
  async function download(e, name, btn) {
    const was = btn ? btn.textContent : '';
    if (btn) { if (btn.dataset.busy) return; btn.dataset.busy = '1'; btn.textContent = 'Making the PDF…'; }
    try {
      const r = await make(e, name), url = URL.createObjectURL(r.blob), a = document.createElement('a');
      a.href = url; a.download = r.fileName.replace(/"/g, ''); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (x) { alert('Could not make the PDF: ' + (x && x.message ? x.message : x)); }
    finally { if (btn) { btn.textContent = was; delete btn.dataset.busy; } }
  }
  // open the PDF in a new tab; the tab is opened first, on the click itself, so the browser does not block it
  async function view(e, name) {
    const w = window.open('', '_blank');
    if (w) w.document.write('<p style="font:15px sans-serif;padding:20px">Making the prescription PDF…</p>');
    try {
      const r = await make(e, name), url = URL.createObjectURL(r.blob);
      if (w) w.location.href = url; else { const a = document.createElement('a'); a.href = url; a.download = r.fileName; a.click(); }
    } catch (x) { if (w) w.close(); alert('Could not make the PDF: ' + (x && x.message ? x.message : x)); }
  }
  window.pvRxPdf = { make, download, view };
})();
