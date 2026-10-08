"use client";
// The client portal's other panels: meetings, content plan, social statistics and connected accounts.
import PortalPlans from '@/features/content-plan/content-plan-portal';
import { MeetingsList } from '@/features/meetings/meetings';
import { AccountsPanel } from '@/features/social/social-accounts';
import SocialReportView from '@/features/social/social-report';
import type { PortalContext } from "./use-portal";

export function MeetingsScreen({ ctx }: { ctx: PortalContext }) {
  const { copy, onError, records, user, workspaceId } = ctx;
  const myEmail = user.email || '';
  const myId = user.id || '';
  const filteredRecords = records.filter(r => {
    if (r.kind !== 'meeting') return true;
    if (!r.attendees || r.attendees.length === 0) return true;
    return r.attendees.includes(myId) || r.attendees.includes(myEmail);
  });
  return <>
    <div className="page-heading"><h1>{copy.meetings}</h1><p>{copy.meetingsText}</p></div>
    <MeetingsList records={filteredRecords} workspaceId={workspaceId ?? undefined} onError={onError} />
  </>;
}
export function PlanScreen({ ctx }: { ctx: PortalContext }) {
  const { client, copy, onError, records, route, thread, workspaceId } = ctx;
  if (!workspaceId) return null;
  return <PortalPlans key={route.detail ?? client.id} initialItemId={route.detail} workspaceId={workspaceId} clientId={client.id} copy={copy} records={records} onError={onError} renderThread={thread} />;
}
export function StatsScreen({ ctx }: { ctx: PortalContext }) {
  const { client, copy, onError, onNotice, records, today, workspaceId } = ctx;
  return <>
    <div className="page-heading"><h1>{copy.stats}</h1><p>{copy.statsText}</p></div>
    {workspaceId && <SocialReportView records={records} clients={[client]} workspaceId={workspaceId} today={today} fixedClientId={client.id} canRefresh={false} onNotice={onNotice} onError={onError} />}
  </>;
}
export function AccountsScreen({ ctx }: { ctx: PortalContext }) {
  const { client, copy, mode, social, workspaceId } = ctx;
  return <>
    <div className="page-heading"><h1>{copy.accounts}</h1><p>{copy.accountsText}</p></div>
    {workspaceId && <AccountsPanel clients={[client]} accounts={social.accounts} available={social.available} workspaceId={workspaceId} fixedClientId={client.id} audience={mode === 'client' ? 'client' : 'studio'} onDisconnect={social.disconnect} />}
  </>;
}