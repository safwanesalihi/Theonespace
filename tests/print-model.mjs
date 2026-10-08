// features/printing/print-model.ts: the print workspace's CSV export stays safe to open in a
// spreadsheet, and keeps its layout (columns, separators, byte order mark).
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['features/printing/print-model.ts'], outfile: '.sites-runtime/print-model-test.mjs', bundle: true, platform: 'node', format: 'esm' });
const { csvCell, movementsCsv, emptyDraft } = await import(pathToFileURL(process.cwd() + '/.sites-runtime/print-model-test.mjs'));
let assertions = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); assertions++; };

// Quotes are doubled; every cell is quoted.
eq(csvCell('Affiche "A3"'), '"Affiche ""A3"""', 'quotes doubled');
eq(csvCell(''), '""', 'empty cell');
// A value a spreadsheet would evaluate starts with an apostrophe instead.
for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
  eq(csvCell(`${lead}HYPERLINK("https://evil.test")`), `"'${lead}HYPERLINK(""https://evil.test"")"`, `formula guard for ${JSON.stringify(lead)}`);
}
eq(csvCell('Facture 12 = payée'), '"Facture 12 = payée"', 'an equals sign inside the text is fine');

const t = (text) => ({ 'Entrée': 'In', 'Sortie': 'Out', 'Client': 'Customer', 'Fournisseur': 'Supplier' }[text] ?? text);
const orders = [{ id: 'o1', kind: 'print_order', name: '500 flyers' }];
const csv = movementsCsv([
  { id: 'm1', kind: 'print_transaction', name: 'Acompte', transactionDate: '2026-10-02', direction: 'in', amountCents: 150000, counterparty: 'Café Nour', counterpartyType: 'customer', orderId: 'o1' },
  { id: 'm2', kind: 'print_transaction', name: '=SUM(A1:A9)', transactionDate: '2026-10-03', direction: 'out', amountCents: 2550, counterpartyType: 'supplier', expenseCategory: 'Papier' },
], orders, t);
assert.ok(csv.startsWith('﻿'), 'byte order mark for spreadsheets'); assertions++;
const rows = csv.slice(1).split('\r\n');
eq(rows.length, 3, 'a header and one row per movement');
eq(rows[0], ['Date', 'Libellé', 'Type', 'Montant (MAD)', 'Interlocuteur', 'Client / Fournisseur', 'Catégorie', 'Commande'].map((h) => `"${h}"`).join(';'), 'header');
eq(rows[1], '"2026-10-02";"Acompte";"In";"1500.00";"Café Nour";"Customer";"";"500 flyers"', 'income row with its order');
eq(rows[2], `"2026-10-03";"'=SUM(A1:A9)";"Out";"25.50";"";"Supplier";"Papier";""`, 'expense row, formula neutralised');

eq(emptyDraft('facture'), { docType: 'facture', docStatus: 'draft', counterparty: '', lineItems: [{ description: '', quantity: 1, unitPrice: 0 }], taxRate: '20', issuedAt: '', dueAt: '', validUntil: '', notes: '' }, 'empty invoice draft');

console.log(`print model: ${assertions} assertions passed`);
