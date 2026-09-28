'use client';
// Browser-side wrapper: fetches the studio logo and hands it to the shared (isomorphic) PDF
// builder — same pattern as lib/invite-pdf.ts.
import type { DocStatus, DocType, LineItem } from '@/lib/model';

export async function buildDocumentPdf(args: {
  docType: DocType;
  number: string;
  docStatus: DocStatus;
  studioName: string;
  clientName: string;
  issuedAt?: string;
  dueAt?: string;
  validUntil?: string;
  lineItems: LineItem[];
  taxRate?: number;
  notes?: string;
  /** The workspace's own logo (a PNG address); null: none; absent: The One Core's. */
  logoUrl?: string | null;
}): Promise<Uint8Array> {
  const source = args.logoUrl === undefined ? '/the-one-core-logo-pdf.png' : args.logoUrl;
  const logoPngBytes = source
    ? await fetch(source).then((r) => (r.ok && r.headers.get('content-type') === 'image/png' ? r.arrayBuffer() : null)).catch(() => null)
    : null;
  // pdf-lib is large: loaded only when someone actually downloads a PDF.
  const { buildDocumentPdf: buildDocumentPdfCore } = await import('@/lib/document-pdf-core');
  return buildDocumentPdfCore({ ...args, logoPngBytes });
}

export { downloadPdf } from '@/lib/invite-pdf';
