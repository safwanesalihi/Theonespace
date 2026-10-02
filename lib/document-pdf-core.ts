import { PDFDocument, PDFHexString, StandardFonts, rgb, beginText, endText, setFillingRgbColor, setFontAndSize, setTextMatrix, showText, type PDFPage, type PDFImage, type PDFName } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { computeTotals, docLabels, docStatusLabels } from './documents';
import { scopeSections, type ServiceScope, type WorkflowSnapshot } from './client-pipeline';
import type { DocStatus, DocType, RecordItem } from './model';

export interface PdfOptions {
  docType: string; number: string; docStatus?: string; studioName: string; clientName: string;
  issuedAt?: string; dueAt?: string; validUntil?: string;
  lineItems: { description: string; quantity: number; unitPrice: number }[];
  taxRate?: number; notes?: string; counterparty?: string;
  serviceScope?: ServiceScope; workflowTerms?: WorkflowSnapshot; documentDecision?: RecordItem['documentDecision'];
  template?: { identity: string; payment: string };
  logoPngBytes?: Uint8Array | ArrayBuffer | null; fontBytes?: Uint8Array | ArrayBuffer | null;
}
const color = (hex: string) => rgb(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]);
const ink = color('#20232b'), muted = color('#59616e'), dark = color('#191b20'), gold = color('#d4af37'), goldInk = color('#765b14'), pale = color('#f5f6f8'), rule = color('#e1e4e9'), white = rgb(1, 1, 1);
const clean = (v: string) => v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[   ]/g, ' ');
const money = (v: number) => clean(v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const date = (v?: string) => v ? v.split('-').reverse().join('/') : '—';

/** Full, paginated terms. No financial text, notes or scope definitions are cut off. */
export async function buildDocumentPdf(args: PdfOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${docLabels[args.docType as DocType] || 'Document'} ${args.number}`);
  pdf.setAuthor(args.studioName);
  pdf.registerFontkit(fontkit);
  // Embed the complete TrueType companion of the app font for reliable Arabic shaping.
  const font = args.fontBytes ? await pdf.embedFont(args.fontBytes, { subset: false }) : await pdf.embedFont(StandardFonts.Helvetica);
  const bold = args.fontBytes ? font : await pdf.embedFont(StandardFonts.HelveticaBold);
  const shapingFont = args.fontBytes ? fontkit.create(new Uint8Array(args.fontBytes)) : null;
  const fontKeys = new Map<PDFPage, PDFName>();
  let logo: PDFImage | undefined;
  if (args.logoPngBytes) { try { logo = await pdf.embedPng(args.logoPngBytes); } catch { /* the workspace name remains visible */ } }
  const width = 595.28, height = 841.89, margin = 38, contentWidth = width - margin * 2;
  let page!: PDFPage, y = 0;
  const arabic = (s: string) => /[\u0600-\u06ff]/.test(s) && !!shapingFont;
  const runs = (s: string) => s.match(/[\u0600-\u06ff]+(?:\s+[\u0600-\u06ff]+)*|[^\u0600-\u06ff]+/g) || [];
  const textWidth = (s: string, size: number, f = font) => arabic(s) ? runs(clean(s)).reduce((n, run) => n + (arabic(run) ? shapingFont!.layout(run).positions.reduce((sum, p) => sum + p.xAdvance, 0) * size / shapingFont!.unitsPerEm : f.widthOfTextAtSize(run, size)), 0) : f.widthOfTextAtSize(clean(s), size);
  function draw(s: string, x: number, at: number, size = 10, f = font, c = ink) {
    s = clean(s);
    if (!arabic(s)) { page.drawText(s, { x, y: at, size, font: f, color: c }); return; }
    // pdf-lib's drawText ignores glyph positioning. Arabic joining and diacritics
    // require the advances/offsets produced by the shaping engine.
    let key = fontKeys.get(page); if (!key) { key = page.node.newFontDictionary(f.name, f.ref); fontKeys.set(page, key); }
    const scale = size / shapingFont!.unitsPerEm;
    for (const part of runs(s)) {
      if (!arabic(part)) { page.drawText(part, { x, y: at, size, font: f, color: c }); x += textWidth(part, size, f); continue; }
      const run = shapingFont!.layout(part), encoded = f.encodeText(part).asString();
      page.pushOperators(beginText(), setFillingRgbColor(c.red, c.green, c.blue), setFontAndSize(key, size));
      let advance = 0;
      run.positions.forEach((pos, i) => { page.pushOperators(setTextMatrix(1, 0, 0, 1, x + (advance + pos.xOffset) * scale, at + pos.yOffset * scale), showText(PDFHexString.of(encoded.slice(i * 4, i * 4 + 4)))); advance += pos.xAdvance; });
      page.pushOperators(endText()); x += advance * scale;
    }
  }
  function fitted(s: string, x: number, at: number, max: number, size = 10, f = font, c = ink) { const fit = Math.min(size, size * max / Math.max(textWidth(s, size, f), 1)); draw(s, x, at, fit, f, c); }
  function addPage(first = false) {
    page = pdf.addPage([width, height]);
    const h = first ? 100 : 64;
    page.drawRectangle({ x: 0, y: height - h, width, height: h, color: dark });
    if (first && logo) { const scale = Math.min(140 / logo.width, 54 / logo.height); page.drawImage(logo, { x: margin, y: height - 72, width: logo.width * scale, height: logo.height * scale }); }
    else fitted(args.studioName, margin, height - 36, 255, 17, bold, white);
    const title = (docLabels[args.docType as DocType] || 'Document').toUpperCase();
    draw(title, width - margin - textWidth(title, 18, bold), height - 36, 18, bold, gold);
    draw(args.number, width - margin - textWidth(args.number, 10), height - 55, 10, font, white);
    if (first) draw(docStatusLabels[args.docStatus as DocStatus] || '', width - margin - textWidth(docStatusLabels[args.docStatus as DocStatus] || '', 9), height - 76, 9, font, white);
    y = height - h - 30;
  }
  function ensure(space: number) { if (y - space < 54) addPage(); }
  function wrap(s: string, max: number, size = 10, f = font) {
    const lines: string[] = [];
    for (const paragraph of clean(s).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (textWidth(`${line}${line ? ' ' : ''}${word}`, size, f) <= max) { line += `${line ? ' ' : ''}${word}`; continue; }
        if (line) { lines.push(line); line = ''; }
        if (textWidth(word, size, f) <= max) { line = word; continue; }
        for (const char of Array.from(word)) { if (textWidth(line + char, size, f) > max) { lines.push(line); line = ''; } line += char; }
      }
      lines.push(line);
    }
    return lines;
  }
  function paragraph(s: string, size = 10, f = font, c = ink, inset = 0) {
    for (const line of wrap(s, contentWidth - inset, size, f)) {
      ensure(size + 7);
      const rtl = /^[\s\d\W]*[\u0600-\u06ff]/.test(line);
      draw(line, rtl ? width - margin - textWidth(line, size, f) : margin + inset, y, size, f, c); y -= size + 6;
    }
    y -= 5;
  }
  function section(title: string) { ensure(55); y -= 12; draw(title, margin, y, 12, bold, goldInk); y -= 12; page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .6, color: rule }); y -= 22; }
  const qtyX = 318, unitX = 371, totalX = 462;
  function tableHeader() {
    ensure(48); page.drawRectangle({ x: margin, y: y - 28, width: contentWidth, height: 28, color: gold });
    draw('DESCRIPTION', margin + 10, y - 18, 9, bold); draw('QTÉ', qtyX, y - 18, 9, bold); draw('P.U. HT / MAD', unitX, y - 18, 9, bold); draw('TOTAL HT', totalX, y - 18, 9, bold); y -= 38;
  }
  addPage(true);
  paragraph('CLIENT', 9, bold, goldInk);
  paragraph(args.counterparty || args.clientName, 12, bold);
  paragraph(`Émis le : ${date(args.issuedAt)}${args.validUntil ? ` · Offre valable jusqu’au : ${date(args.validUntil)}` : ''}${args.dueAt ? ` · Échéance : ${date(args.dueAt)}` : ''}`, 9, font, muted);
  if (args.template && !args.serviceScope?.issuerIdentity) { paragraph('PRESTATAIRE', 9, bold, goldInk); paragraph(args.template.identity, 9, font, muted); }
  tableHeader();
  for (const item of args.lineItems) {
    const lines = wrap(item.description, qtyX - margin - 24, 10);
    const rowHeight = Math.max(32, lines.length * 16 + 10);
    if (y - rowHeight < 54) { addPage(); tableHeader(); }
    page.drawRectangle({ x: margin, y: y - rowHeight, width: contentWidth, height: rowHeight, color: pale });
    lines.forEach((line, i) => draw(line, margin + 10, y - 17 - i * 16));
    fitted(String(item.quantity), qtyX, y - 17, 40); fitted(money(item.unitPrice), unitX, y - 17, 80); fitted(money(item.quantity * item.unitPrice), totalX, y - 17, 84, 10, bold);
    y -= rowHeight + 4;
  }
  const totals = computeTotals(args.lineItems, args.taxRate);
  ensure(115); y -= 16;
  for (const [label, value] of [['Sous-total HT', totals.subtotal], [`TVA (${args.taxRate || 0} %)`, totals.taxAmount], ['Total TTC', totals.total]] as const) {
    draw(label, unitX - 40, y, 10, bold, muted);
    const s = `${money(value)} MAD`; fitted(s, totalX - 10, y, 94, label === 'Total TTC' ? 12 : 10, bold, label === 'Total TTC' ? goldInk : ink); y -= 25;
  }
  if (args.serviceScope) for (const block of scopeSections(args.serviceScope, args.workflowTerms)) { section(block.title); for (const line of block.lines) paragraph(line); }
  if (args.notes) { section('Conditions particulières et notes'); paragraph(args.notes); }
  if (args.template && !args.serviceScope?.paymentTerms) { section('Conditions de paiement'); paragraph(args.template.payment); }
  if (args.documentDecision) { section('Décision enregistrée'); paragraph(`${args.documentDecision.status === 'accepted' ? 'Accepté' : 'Refusé'} par ${args.documentDecision.by}${args.documentDecision.email ? ` (${args.documentDecision.email})` : ''}, le ${args.documentDecision.at}. ${args.documentDecision.method === 'portal' ? 'Accord enregistré depuis le portail.' : 'Accord consigné par le studio.'}`); }
  if (args.docType === 'contract') { section('Accord des parties'); paragraph('Le périmètre, les montants et les conditions ci-dessus sont à confirmer par les parties. Conserver le contrat signé ou la preuve d’accord avec ce document.'); ensure(80); draw(`Pour ${args.studioName}`, margin, y, 10, bold); fitted(`Pour ${args.clientName}`, width / 2 + 10, y, contentWidth / 2 - 16, 10, bold); y -= 48; page.drawLine({ start: { x: margin, y }, end: { x: width / 2 - 20, y }, thickness: .8, color: rule }); page.drawLine({ start: { x: width / 2 + 10, y }, end: { x: width - margin, y }, thickness: .8, color: rule }); }
  const pages = pdf.getPages();
  pages.forEach((p, i) => { page = p; p.drawLine({ start: { x: margin, y: 38 }, end: { x: width - margin, y: 38 }, thickness: .6, color: rule }); fitted(`${args.studioName} · ${args.number}`, margin, 23, contentWidth - 65, 8, font, muted); const n = `${i + 1} / ${pages.length}`; draw(n, width - margin - textWidth(n, 8), 23, 8, font, muted); });
  return pdf.save();
}
