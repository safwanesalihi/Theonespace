// Keeps /admin/finance out of sight. For anyone but the owner (OWNER_EMAIL), the request is answered
// as if the address didn't exist: rewritten to a path no route matches, so it gets the site's ordinary
// prerendered 404, byte for byte. (A notFound() thrown by the page itself renders a different 404 shell
// that a curious visitor could tell apart.) The page and its data route still check on their own —
// this only makes the refusal indistinguishable; it is not the only lock.
import { NextResponse, type NextRequest } from 'next/server';
import { financeOwner } from '@/lib/finance-dashboard';

export async function proxy(request: NextRequest) {
  if (await financeOwner(request)) return NextResponse.next();
  return NextResponse.rewrite(new URL('/__not-found', request.url));
}

export const config = { matcher: ['/admin/finance', '/admin/finance/:path*'] };
