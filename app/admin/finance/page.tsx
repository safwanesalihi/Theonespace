// Owner-only finance dashboard. Not linked from anywhere, not indexed, and for anyone but the owner
// (OWNER_EMAIL) — signed out, another account, a client — it is the site's ordinary 404, so its
// existence isn't advertised. The dashboard itself is served by ./data, behind the same check.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { dashboardInfo, financeOwner } from '@/lib/finance-dashboard';
import FinanceView from './finance-view';
import './finance.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Finance — The One Core', robots: { index: false, follow: false, nocache: true } };

export default async function FinancePage() {
  const owner = await financeOwner();
  if (!owner) notFound();
  return <FinanceView info={await dashboardInfo(owner)} />;
}
