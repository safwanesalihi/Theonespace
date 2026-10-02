'use client';
import { useState } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useI18n } from './locale-provider';
import DatePicker from './date-picker';
import { scopeLabels, scopeSections, serviceScopeSchema, type ServiceScope, type WorkflowSnapshot } from '@/lib/client-pipeline';
import styles from './client-pipeline.module.css';

export function ScopeSummary({ scope, workflow }: { scope: ServiceScope; workflow?: WorkflowSnapshot }) {
  const { t } = useI18n();
  return <div className={styles.summary}>{scopeSections(scope, workflow).map(section => <details key={section.title}><summary>{t(section.title)}</summary><ul>{section.lines.map((line, i) => <li key={i}>{line}</li>)}</ul></details>)}</div>;
}

export default function ServiceScopeEditor({ initial, onClose, onSave }: { initial: ServiceScope; onClose: () => void; onSave: (scope: ServiceScope) => Promise<unknown> }) {
  const { t } = useI18n();
  const [scope, setScope] = useState(initial);
  const [platformsText, setPlatformsText] = useState(initial.platforms.join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof ServiceScope>(key: K, value: ServiceScope[K]) => setScope(s => ({ ...s, [key]: value }));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError('');
    const parsed = serviceScopeSchema.safeParse({ ...scope, platforms: [...new Set(platformsText.split(',').map(v => v.trim()).filter(Boolean))] });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setSaving(true);
    try { await onSave(parsed.data); onClose(); } catch (e) { setError(t((e as Error).message)); } finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className={`tracker-modal ${styles.scopeModal}`}>
    <DialogHeader><DialogTitle>{t('Périmètre de prestation')}</DialogTitle><DialogDescription>{t('Le même périmètre sera repris dans le devis et le contrat. Les documents déjà envoyés gardent leur version.')}</DialogDescription></DialogHeader>
    <form className="form-fields" onSubmit={save}>
      <label className="form-field"><span>{t('Nom du forfait')}</span><input required maxLength={160} value={scope.title} onChange={e => set('title', e.target.value)} /></label>
      <div className="form-pair">{([['issuerIdentity', 'Identité du prestataire'], ['clientIdentity', 'Identité du client']] as const).map(([key, label]) => <label className="form-field" key={key}><span>{t(label)}</span><textarea rows={3} maxLength={3000} value={scope[key] || ''} onChange={e => set(key, e.target.value)} placeholder={t('Raison sociale, adresse, identifiants et contact')} /></label>)}</div>
      <div className="form-pair"><label className="form-field"><span>{t('Périodicité')}</span><select value={scope.cadence} onChange={e => set('cadence', e.target.value as ServiceScope['cadence'])}><option value="monthly">{t('Mensuel')}</option><option value="once">{t('Prestation ponctuelle')}</option></select></label><label className="form-field"><span>{t('Contact de validation')}</span><input maxLength={160} value={scope.approver} onChange={e => set('approver', e.target.value)} /></label></div>
      <div className="form-pair"><label className="form-field"><span>{t('Début de prestation')}</span><DatePicker label={t('Début de prestation')} value={scope.startDate} onChange={v => set('startDate', v)} placeholder={t('Choisir')} /></label><label className="form-field"><span>{t('Fin de prestation')}</span><DatePicker label={t('Fin de prestation')} value={scope.endDate} onChange={v => set('endDate', v)} placeholder={t('Sans date')} /></label></div>
      <div className="form-pair"><label className="form-field"><span>{t('Plateformes')}</span><input maxLength={600} placeholder="Instagram, Facebook" value={platformsText} onChange={e => setPlatformsText(e.target.value)} /></label><label className="form-field"><span>{t('Langues')}</span><input maxLength={160} placeholder={t('Français, arabe…')} value={scope.languages} onChange={e => set('languages', e.target.value)} /></label></div>
      <h3>{t('Quantités incluses')}</h3><p className="small-note">{t('1 frame de story = 1 unité. Définissez aussi durée des reels, slides des carrousels et durée des shootings. Une quantité de 0 signifie non inclus.')}</p>
      {scope.items.map((item, i) => <div className={styles.scopeItem} key={item.format}>
        <label className="form-field"><span>{t(scopeLabels[item.format])}</span><input type="number" min={0} max={10000} step={1} value={item.quantity} onChange={e => set('items', scope.items.map((v, n) => n === i ? { ...v, quantity: Number(e.target.value) } : v))} /></label>
        <label className="form-field"><span>{t('Définition et limites')}</span><textarea rows={2} maxLength={3000} value={item.definition} onChange={e => set('items', scope.items.map((v, n) => n === i ? { ...v, definition: e.target.value } : v))} /></label>
      </div>)}
      <details className={styles.editorDetails} open><summary>{t('Décompte et responsabilités')}</summary><div className="form-fields">
        {([['adaptations', 'Adaptations et reposts'], ['communityManagement', 'Community management'], ['exclusions', 'Exclusions'], ['clientInputs', 'Éléments à fournir']] as const).map(([key, label]) => <label className="form-field" key={key}><span>{t(label)}</span><textarea rows={2} maxLength={3000} value={scope[key]} onChange={e => set(key, e.target.value)} /></label>)}
        <label className="form-field"><span>{t('Unités inutilisées')}</span><select value={scope.carryover} onChange={e => set('carryover', e.target.value as ServiceScope['carryover'])}><option value="none">{t('Pas de report')}</option><option value="written">{t('Report uniquement par accord écrit')}</option></select></label>
      </div></details>
      <details className={styles.editorDetails} open><summary>{t('Paiement, durée et droits')}</summary><div className="form-fields">{([['paymentTerms', 'Conditions de paiement'], ['cancellationTerms', 'Durée et résiliation'], ['rights', 'Droits et fichiers sources']] as const).map(([key, label]) => <label className="form-field" key={key}><span>{t(label)}</span><textarea rows={3} maxLength={3000} value={scope[key]} onChange={e => set(key, e.target.value)} /></label>)}</div></details>
      <details className={styles.editorDetails} open><summary>{t('Tarifs hors forfait')}</summary><p className="small-note">{t('Un prix vide signifie « sur devis ». Chaque extra nécessite un accord explicite avant production.')}</p><div className="form-fields">
        {scope.extras.map((extra, i) => <div className={styles.extraRow} key={i}>
          <label className="form-field"><span>{t('Prestation')}</span><input required maxLength={160} value={extra.label} onChange={e => set('extras', scope.extras.map((v, n) => n === i ? { ...v, label: e.target.value } : v))} /></label>
          <label className="form-field"><span>{t('Unité')}</span><input required maxLength={80} value={extra.unit} onChange={e => set('extras', scope.extras.map((v, n) => n === i ? { ...v, unit: e.target.value } : v))} /></label>
          <label className="form-field"><span>{t('Prix HT (MAD)')}</span><input type="number" min={0} max={10000000} step="0.01" placeholder={t('Sur devis')} value={extra.unitPrice ?? ''} onChange={e => set('extras', scope.extras.map((v, n) => n === i ? { ...v, unitPrice: e.target.value === '' ? null : Number(e.target.value) } : v))} /></label>
          <button type="button" className="icon-button" aria-label={t('Retirer la ligne')} onClick={() => set('extras', scope.extras.filter((_, n) => n !== i))}><Trash2 size={15} /></button>
        </div>)}
        <button type="button" className="text-link" disabled={scope.extras.length >= 20} onClick={() => set('extras', [...scope.extras, { label: '', unit: '', unitPrice: null }])}><Plus size={14} />{t('Ajouter une ligne')}</button>
      </div></details>
      {error && <p className="form-error" role="alert">{error}</p>}
      <DialogFooter className="modal-footer"><button type="button" className="btn" disabled={saving} onClick={onClose}>{t('Annuler')}</button><button className="btn primary" disabled={saving}>{saving && <Loader2 size={15} className="spin" />}{t('Enregistrer')}</button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
