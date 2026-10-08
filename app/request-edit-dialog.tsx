'use client';

import { useRef, useState } from 'react';
import { Check, Loader2, Save } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DatePicker from '@/app/date-picker';
import { useI18n } from '@/lib/i18n/locale-provider';
import { priorities, requestPlatforms, type Priority, type RecordItem } from '@/lib/model';

// One editor for the studio inbox and client portal; the server enforces client ownership and revision.
export default function RequestEditDialog({ request, projects, busy, mutate, onClose, onSaved }: {
  request: RecordItem; projects: RecordItem[]; busy: boolean;
  mutate: (body: Record<string, unknown>) => Promise<unknown>; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [details, setDetails] = useState(() => ({ name: request.name, projectId: request.projectId ?? '', due: request.due ?? '',
    description: request.description ?? '', platforms: request.platforms ?? [], priority: request.priority ?? 'Moyenne' as Priority }));
  const [initial] = useState(() => JSON.stringify(details));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const active = useRef(false);
  const disabled = busy || saving;
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (active.current || disabled) return;
    active.current = true; setSaving(true); setError('');
    try { await mutate({ action: 'request-update', id: request.id, revision: request.revision, data: details }); onSaved(); }
    catch (e) { setError(t((e as Error).message)); }
    finally { active.current = false; setSaving(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !disabled) onClose(); }}>
    <DialogContent className="tracker-modal request-edit-dialog" showCloseButton={!disabled}>
      <DialogHeader><DialogTitle>{t('Modifier la demande')}</DialogTitle><DialogDescription>{t('Ajustez les détails avant que le studio traite cette demande.')}</DialogDescription></DialogHeader>
      <form className="form-fields" onSubmit={save}>
        <fieldset className="request-edit-fields" disabled={disabled}>
          <label className="form-field"><span>{t('Titre de la demande')} *</span><input required maxLength={160} autoFocus value={details.name} onChange={e => setDetails({ ...details, name: e.target.value })} /></label>
          <div className="form-pair">
            <div className="form-field"><span>{t('Sous-projet')}</span><Select disabled={disabled} value={details.projectId || '__none'} onValueChange={value => setDetails({ ...details, projectId: value === '__none' ? '' : value })}>
              <SelectTrigger className="pick" aria-label={t('Sous-projet')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">{t('Sans sous-projet')}</SelectItem>
                {projects.filter(p => p.kind === 'project' && p.clientId === request.clientId && !p.archived).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent></Select></div>
            <div className="form-field"><span>{t('Date souhaitée')}</span><DatePicker label={t('Date souhaitée')} value={details.due} onChange={due => setDetails({ ...details, due })} placeholder={t('Sans date')} /></div>
          </div>
          <div className="form-field"><span>{t('Priorité')}</span><Select disabled={disabled} value={details.priority} onValueChange={priority => setDetails({ ...details, priority: priority as Priority })}>
            <SelectTrigger className="pick" aria-label={t('Priorité')}><SelectValue /></SelectTrigger><SelectContent>{priorities.map(priority => <SelectItem key={priority} value={priority}>{t(priority)}</SelectItem>)}</SelectContent>
          </Select></div>
          <fieldset className="form-field request-platforms"><legend>{t('Plateformes')}</legend><div role="group" aria-label={t('Plateformes')}>
            {requestPlatforms.map(platform => { const selected = details.platforms.includes(platform); return <button key={platform} type="button" aria-pressed={selected} className={selected ? 'selected' : ''}
              onClick={() => setDetails({ ...details, platforms: selected ? details.platforms.filter(p => p !== platform) : [...details.platforms, platform] })}>{selected && <Check size={14} />}{t(platform)}</button>; })}
          </div></fieldset>
          <label className="form-field"><span>{t('Brief')}</span><textarea rows={5} maxLength={15000} value={details.description} onChange={e => setDetails({ ...details, description: e.target.value })} /></label>
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <DialogFooter className="modal-footer"><button type="button" className="btn" disabled={disabled} onClick={onClose}>{t('Annuler')}</button>
          <button className="btn primary" disabled={disabled || !details.name.trim() || JSON.stringify(details) === initial}>{saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}{t('Enregistrer les modifications')}</button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
