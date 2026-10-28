"use client";
// The client portal's review page: the deliverable, its approval actions and countdown, the receipt
// once validated, and the conversation.
import { timeZoneLabel } from "@/lib/time";
import { revisionState } from '@/lib/flow';
import { taskWorkflowSettings } from '@/lib/workflow-settings';
import { ArrowLeft, ArrowUpRight, Check, FileText, RotateCcw } from 'lucide-react';
import { Stamp } from "@/components/moments/stamp";
import { SwipeDecide } from "@/components/moments/swipe-decide";
import { BorderBeam } from "@/components/ui/border-beam";
import { Countdown, Rounds } from "./portal-parts";
import { Chip } from "./portal-chip";
import type { PortalContext } from "./use-portal";

/** « drive.google.com »: where the file opens, so the client knows before clicking. */
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

export function ReviewScreen({ ctx }: { ctx: PortalContext }) {
  const { busy, copy, fmt, link, onBack, pname, rtl, sealed, setConfirm, setDialog, setFormError, t, task, thread } = ctx;
  if (!task) return <div className="portal-empty"><h2>{copy.notFound}</h2></div>;
  const url = link(task);
  const signOff = task.signOff;
  const askChanges = () => { setFormError(''); setDialog('changes'); };
  const askApprove = () => { setFormError(''); setConfirm(false); setDialog('approve'); };
  const actions = <>
    <button className="btn" disabled={busy} onClick={askChanges}>{copy.requestChanges}</button>
    <button className="btn primary" disabled={busy} onClick={askApprove}><Check size={16} />{copy.approve}</button>
  </>;
  return <>
    {task.status === 'À valider' && <div className="portal-actionbar mobile-only">{actions}</div>}
    <div className="pc-page">
    <button className="text-link back" onClick={onBack}><ArrowLeft size={15} />{t("Retour")}</button>
    <div className="page-heading"><div className="heading-line"><h1>{task.name}</h1>{task.status !== 'À valider' && <Chip status={task.status} copy={copy} />}</div><p>{[pname(task.projectId), task.due ? copy.dueOn(fmt(task.due)) : ''].filter(Boolean).join(' · ')}</p></div>
    {/* The decision in one place: the clock and the rule on one side, the two answers on the other. */}
    {/* On a phone the card can be thrown: toward the end of the line to approve, back to ask for changes. */}
    {task.status === 'À valider' && <SwipeDecide rtl={rtl} disabled={busy} onApprove={askApprove} onChanges={askChanges}
      approve={<><Check size={18} />{copy.approve}</>} changes={<><RotateCcw size={18} />{copy.requestChanges}</>}
      hint={t(rtl ? 'Glissez vers la gauche pour valider, vers la droite pour demander des retouches.' : 'Glissez vers la droite pour valider, vers la gauche pour demander des retouches.')}>
    <section className="portal-decision has-beam" aria-label={copy.review}>
      <BorderBeam />
      <div className="portal-decision-clock"><Countdown ctx={ctx} t={task} /><small>{copy.clockRule(taskWorkflowSettings(task).validationHours)}</small><Rounds ctx={ctx} t={task} /></div>
      <div className="portal-decision-actions desktop-only">{actions}</div>
    </section></SwipeDecide>}
    {task.pendingExtraRequestId && <p className="small-note">{t('Tour supplémentaire en attente de devis et d’accord explicite. Le livrable est en pause.')}</p>}
    {/* Approved here a moment ago: the seal strikes, then the receipt prints under it. */}
    {signOff && <div className={`portal-receipt${sealed === task.id ? ' is-fresh' : ''}`}><Stamp play={sealed === task.id} size={60} /><div><strong>{copy.receipt}</strong><dl><div><dt>{copy.receiptMode}</dt><dd>{signOff.mode === 'silence' ? copy.silence : signOff.mode === 'studio' ? copy.studio : copy.explicit}</dd></div><div><dt>{copy.receiptContact}</dt><dd>{signOff.by}{signOff.email ? ` · ${signOff.email}` : ''}</dd></div><div><dt>{copy.receiptWhen}</dt><dd>{fmt(signOff.at, true)} · {timeZoneLabel(signOff.at)}</dd></div><div><dt>{copy.receiptRound}</dt><dd>{signOff.round} / {revisionState(task).included}</dd></div></dl></div></div>}
    <div className="review-layout">
      <div className="review-canvas"><div className="external-file"><span className="external-file-icon"><FileText size={30} /></span><h2>{copy.externalTitle}</h2><p>{copy.externalText}</p>{url ? <><a className="btn" href={url} target="_blank" rel="noopener noreferrer">{copy.openFile}<ArrowUpRight size={16} /></a><small className="external-file-host" dir="ltr">{hostOf(url)}</small></> : <p>{copy.noLink}</p>}</div></div>
      <aside>
        {thread(task.id)}
      </aside>
    </div>
  </div>
  </>;
}