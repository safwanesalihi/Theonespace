"use client";
// Small parts of the client portal: a scheduled post with its approval actions, the silent-approval
// countdown and the revision rounds used.
import { Surface } from "@/components/ui/surface";
import NetworkIcon from '@/components/network-icon';
import PostPreview from '@/features/social/post-preview';
import { hoursLeft, revisionState } from '@/lib/flow';
import { type RecordItem } from '@/lib/model';
import { captionFor, mediaOf, targetsOf } from '@/lib/social';
import { CalendarDays, Check, Clock, Send } from 'lucide-react';
import type { PortalContext } from "./use-portal";

export function PostCard({ ctx, post }: { ctx: PortalContext; post: RecordItem }) {
  const { answerPost, askingChanges, busy, client, copy, planned, postNetwork, postNote, setAskingChanges, setPostNetwork, setPostNote } = ctx;
  const targets = targetsOf(post);
  const shown = targets.find((x) => x.network === postNetwork) ?? targets[0];
  const pending = post.approval?.state === 'pending' && !post.publishedAt;
  return <Surface asChild tone="default" key={post.id}><article className="post-card">
    <header className="post-card-head">
      <div><strong>{post.name}</strong><small><CalendarDays size={12} /> {planned(post)}</small></div>
      <span className={`post-card-state ${post.publishedAt ? 'published' : post.approval?.state || 'scheduled'}`}>
        {post.publishedAt ? copy.postPublished : post.approval ? copy.postState[post.approval.state] : copy.postScheduled}
      </span>
    </header>
    {targets.length > 1 && <div className="post-card-networks" role="tablist">{targets.map((x) => <button key={x.network} type="button" role="tab" aria-selected={shown?.network === x.network} className={shown?.network === x.network ? 'selected' : ''} onClick={() => setPostNetwork(x.network)}><NetworkIcon network={x.network} size={14} /></button>)}</div>}
    {shown && <PostPreview target={shown} media={mediaOf(post)} caption={captionFor(post, shown)} account={client.name} />}
    {pending && (askingChanges === post.id
      ? <div className="post-card-changes">
          <textarea rows={3} maxLength={2000} value={postNote} placeholder={copy.postChangesPlaceholder} onChange={(e) => setPostNote(e.target.value)} autoFocus />
          <div className="post-card-actions"><button type="button" className="btn" disabled={busy} onClick={() => { setAskingChanges(null); setPostNote(''); }}>{copy.cancel}</button><button type="button" className="btn primary" disabled={busy || !postNote.trim()} onClick={() => void answerPost(post, false)}><Send size={15} />{copy.sendChanges}</button></div>
        </div>
      : <div className="post-card-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => { setPostNote(''); setAskingChanges(post.id); }}>{copy.postChanges}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void answerPost(post, true)}><Check size={16} />{copy.postApprove}</button>
        </div>)}
  </article></Surface>;
}
export function Countdown({ ctx, t }: { ctx: PortalContext; t: RecordItem }) {
  const { copy, now } = ctx;
  const left = hoursLeft(t, now);
  if (left === null) return null;
  return <div className="portal-clock"><Clock size={15} /><span>{copy.clock(Math.max(0, left))}</span></div>;
}
export function Rounds({ ctx, t }: { ctx: PortalContext; t: RecordItem }) {
  const { copy } = ctx;
  const r = revisionState(t);
  return <p className="portal-rounds">{copy.rounds(r.used, r.included)}{r.overBudget ? ` · ${copy.roundsOver}` : r.lastIncluded ? ` · ${copy.roundsLast}` : ''}</p>;
}