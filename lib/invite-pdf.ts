'use client';
// Browser-side wrapper: fetches the studio logo and hands it to the shared (isomorphic) PDF
// builder. The password never has to be sent back over the network to get it into this PDF.

export async function buildInvitePdf(args: {
  name: string;
  roleLabel: string;
  email: string;
  temporaryPassword: string;
  url: string;
  studioName: string;
  /** The workspace's own logo (a PNG address); null: none; absent: The One Core's. */
  logoUrl?: string | null;
}): Promise<Uint8Array> {
  const source = args.logoUrl === undefined ? '/the-one-core-logo-pdf.png' : args.logoUrl;
  const logoPngBytes = source
    ? await fetch(source).then((r) => (r.ok && r.headers.get('content-type') === 'image/png' ? r.arrayBuffer() : null)).catch(() => null)
    : null;
  // pdf-lib is large: loaded only when someone actually downloads a PDF.
  const { buildInvitePdf: buildInvitePdfCore } = await import('@/lib/invite-pdf-core');
  return buildInvitePdfCore({ ...args, logoPngBytes });
}

/** Triggers a browser download of the generated PDF bytes. */
export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
