"use client";
// The client portal's request form and the client's requests so far.
import DatePicker from '@/components/date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { flow } from '@/lib/flow';
import { type Priority, requestPlatforms } from '@/lib/model';
import { Check, Inbox, Loader2, Send } from 'lucide-react';
import { Chip } from "./portal-chip";
import type { PortalContext } from "./use-portal";

export function RequestScreen({ ctx }: { ctx: PortalContext }) {
  const { busy, copy, fmt, formError, myRequests, navigate, projects, request, sendRequest, setEditingRequest, setRequest, t, tasks } = ctx;
  return <>
    <div className="page-heading"><h1>{copy.requestTitle}</h1><p>{copy.requestText}</p></div>
    <div className="pc-page portal-request">
      <form onSubmit={sendRequest} className="form-fields">
        <label className="form-field"><span>{copy.requestName} *</span><input required maxLength={160} value={request.name} onChange={(e) => setRequest({ ...request, name: e.target.value })} /></label>
        <div className="form-pair">
          <label className="form-field"><span>{copy.requestProject}</span><Select value={request.projectId || '__none'} onValueChange={(v) => setRequest({ ...request, projectId: v === '__none' ? '' : v })}><SelectTrigger className="pick" aria-label={copy.requestProject}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">{copy.choose}</SelectItem>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></label>
          <label className="form-field"><span>{copy.requestDate}</span><DatePicker label={copy.requestDate} value={request.due} onChange={(value) => setRequest({ ...request, due: value })} placeholder={copy.choose} /></label>
          <label className="form-field"><span>{t('Priorité')}</span><Select value={request.priority || 'Moyenne'} onValueChange={(v) => setRequest({ ...request, priority: v as Priority })}><SelectTrigger className="pick" aria-label={t('Priorité')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Basse">{t("Basse")}</SelectItem><SelectItem value="Moyenne">{t("Moyenne")}</SelectItem><SelectItem value="Haute">{t("Haute")}</SelectItem><SelectItem value="Urgente">{t("Urgente")}</SelectItem></SelectContent></Select></label>
        </div>
        <fieldset className="form-field request-platforms">
          <span>{copy.requestPlatforms}</span>
          <div role="group" aria-label={copy.requestPlatforms}>
            {requestPlatforms.map((p) => {
              const on = request.platforms.includes(p);
              return <button type="button" key={p} aria-pressed={on} className={on ? 'selected' : ''} onClick={() => setRequest({ ...request, platforms: on ? request.platforms.filter((x) => x !== p) : [...request.platforms, p] })}>{on && <Check size={14} />}{copy.platformNames[p] ?? p}</button>;
            })}
          </div>
          <small>{copy.requestPlatformsHint}</small>
        </fieldset>
        <label className="form-field"><span>{copy.requestDescription}</span><textarea rows={5} maxLength={15000} value={request.description} onChange={(e) => setRequest({ ...request, description: e.target.value })} /></label>
        <small className="small-note">{copy.requestLockNote(flow.lockDays)}</small>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="inline"><button className="btn primary" disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}{copy.requestButton}</button></div>
      </form>
      <aside>
        <h3>{copy.myRequests}</h3>
        {myRequests.length ? <div className="task-rows">{myRequests.map((r) => {
          // A request in the inbox, or the task it became (older requests went straight to a task).
          const task = r.kind === 'task' ? r : tasks.find((t) => t.id === r.taskId);
          const state = r.kind === 'task' ? 'accepted' : r.requestStatus ?? 'new';
          const label = state === 'accepted' ? copy.requestAccepted : state === 'declined' ? copy.requestDeclined : copy.requestWaiting;
          const line = <><span className="task-line-icon"><Inbox size={16} /></span><span className="task-line-name"><strong>{r.name}</strong><small>{copy.requestedOn(fmt(r.request?.at))}{r.due ? ` · ${copy.dueOn(fmt(r.due))}` : ''}{r.platforms?.length ? ` · ${r.platforms.map((p) => copy.platformNames[p] ?? p).join(', ')}` : ''}</small>{state === 'declined' && r.decision?.reason && <small className="request-reason">{copy.requestReason} : {r.decision.reason}</small>}</span>{task ? <Chip status={task.status} copy={copy} /> : <span className={`request-state ${state}`}>{label}</span>}</>;
          return task ? <button className="task-line" key={r.id} onClick={() => navigate({ page: 'review', id: task.id })}>{line}</button> : <div className="portal-request-item" key={r.id}><div className="task-line">{line}</div>
            {state === 'new' && r.kind === 'request' && <footer><button type="button" className="btn ghost" disabled={busy} aria-label={t('Modifier la demande {name}', { name: r.name })} onClick={() => setEditingRequest(r)}>{t('Modifier les détails')}</button></footer>}
          </div>;
        })}</div> : <p className="small-note">{copy.noRequests}</p>}
      </aside>
    </div>
  </>;
}