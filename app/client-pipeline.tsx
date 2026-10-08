'use client';
import { useState } from 'react';
import { ArrowRight, Check, Circle, FileSignature, SlidersHorizontal } from 'lucide-react';
import { Surface } from '@/components/ui/surface';
import { clientPipeline, pipelineStages, scopeUsage, scopeLabels, scopeReadiness, workflowSnapshot } from '@/lib/client-pipeline';
import type { DocType, RecordItem } from '@/lib/model';
import { useI18n } from '../lib/i18n/locale-provider';
import { ScopeSummary } from './service-scope';
import styles from './client-pipeline.module.css';

export default function ClientPipeline({ client, records, today, busy, onEdit, onNew, onNavigate }: { client: RecordItem; records: RecordItem[]; today: string; busy: boolean; onEdit: () => void; onNew: (type: DocType, source?: RecordItem) => void; onNavigate?: (tab: string) => void }) {
  const { t } = useI18n();
  const pipeline = clientPipeline(client, records, today);
  const [selected, setSelected] = useState<number | null>(null);
  const index = selected ?? pipeline.index;
  const scope = pipeline.contract?.serviceScope || client.serviceScope;
  const usage = scope ? scopeUsage(records, client.id, scope, today.slice(0, 7)) : null;
  const missing = scopeReadiness(client.serviceScope);
  const action = () => index === 0 ? onEdit() : index === 1 ? onNew('devis') : index === 2 ? onNew('contract', pipeline.quote) : index === 7 ? onNew('facture', pipeline.quote) : onNavigate?.(index === 3 ? 'overview' : index === 4 ? 'plan' : 'tasks');
  const actionLabel = ['Définir le forfait', 'Préparer le devis', 'Créer le contrat du devis', 'Compléter le brief', 'Ouvrir le plan', 'Ouvrir les tâches', 'Ouvrir les validations', 'Préparer la facture'][index];
  return <section className={styles.pipeline} aria-label={t('Pipeline client')}>
    <div className="section-head"><div><span className="eyebrow">{t('PARCOURS CLIENT')}</span><h2>{t('Un accord clair, une production sereine')}</h2><p>{t('Le parcours suit les documents et les livrables du client.')}</p></div><button type="button" className="btn" disabled={busy || client.archived} onClick={onEdit}><SlidersHorizontal size={15} />{t('Définir le forfait')}</button></div>
    <ol className={styles.stages}>{pipelineStages.map((stage, i) => <li key={stage.id}><button type="button" className={`${styles.stage} ${i === index ? styles.selected : ''}`} aria-pressed={i === index} aria-current={i === pipeline.index ? 'step' : undefined} onClick={() => setSelected(i)}><span className={styles.stageIcon}>{i < pipeline.index ? <Check size={15} /> : i === pipeline.index ? <Circle size={15} /> : String(i + 1).padStart(2, '0')}</span><span>{t(stage.label)}{i === pipeline.index && <small>{t('Étape actuelle')}</small>}</span></button></li>)}</ol>
    <Surface asChild tone="default"><div className={styles.next}><div><span className="eyebrow">{t(pipelineStages[index].label)}</span><h3>{t(pipelineStages[index].detail)}</h3><p>{index === 2 && !pipeline.quote ? t('Le contrat reprend un devis accepté. Faites accepter le devis pour continuer.') : index === 7 && pipeline.unpaid ? t('{n} facture(s) en attente de paiement.', { n: pipeline.unpaid }) : t('Les devis et les extras sont acceptés explicitement ; le délai de {hours} h concerne les livrables.', { hours: client.effectiveWorkflow?.validationHours ?? 48 })}</p></div><button type="button" className="btn primary" disabled={busy || client.archived || index === 2 && !pipeline.quote} onClick={action}>{t(actionLabel)}<ArrowRight size={15} /></button></div></Surface>
    {scope && <Surface asChild tone="default"><div className={styles.scopeCard}><header><div><h3>{scope.title}</h3><p>{t(pipeline.contract ? 'Périmètre du contrat accepté' : 'Périmètre en préparation')} · {t(scope.cadence === 'monthly' ? 'Mensuel' : 'Prestation ponctuelle')}</p></div><FileSignature size={20} /></header>
      {!!missing.length && !pipeline.contract && <p className={styles.missing}>{t('À compléter avant envoi')} : {missing.map(label => t(label)).join(' · ')}</p>}
      <div className={styles.quantities}>{usage?.rows.map(row => <div key={row.format}><span>{t(scopeLabels[row.format])}</span><strong>{row.planned} <small>/ {row.quantity}</small></strong><progress value={Math.min(row.planned, row.quantity)} max={row.quantity} aria-label={t(scopeLabels[row.format])} /><small>{t('{n} validé(s)', { n: row.approved })}{row.planned > row.quantity ? ` · ${t('Dépassement à qualifier')}` : ''}</small></div>)}</div>
      <p className="small-note">{t('Décompte des tâches et idées du plan ; les programmations sociales et reposts ne sont pas comptés une seconde fois. Chaque nœud Story représente un frame.')}{!!usage?.unclassified && ` ${t('{n} tâche(s) sans format : non décomptées.', { n: usage.unclassified })}`}</p>
      <ScopeSummary scope={scope} workflow={pipeline.contract?.workflowTerms ?? workflowSnapshot(client.effectiveWorkflow)} />
    </div></Surface>}
  </section>;
}
