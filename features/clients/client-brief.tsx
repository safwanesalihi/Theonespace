'use client';
import { Surface } from "@/components/ui/surface";
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Braces, Check, Download, FileUp, Flag, Link2, Loader2, Palette, PenLine, Plus, Sparkles, Target, Trash2, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ClientMark from '@/features/clients/client-mark';
import { useI18n } from '@/lib/i18n/locale-provider';
import { briefHasContent, briefSectionLabels, briefSections, emptyBrief, parseBriefFile, type BriefSection, type ClientBrief } from '@/lib/client-brief';
import { fillEmptySections, type BriefBasis } from '@/lib/brief-ai';
import { clearResult, runInBackground, useBackgroundJob, useBackgroundResult } from '@/features/workspace/background-work';
import type { RecordItem } from '@/lib/model';
import styles from './client-brief.module.css';

const icons = { overview: Sparkles, identity: Palette, goals: Target, audience: Users, requirements: Flag, references: Link2 };
/** What « Remplir avec l’IA » brings back: a proposed brief, what it was built from, the client's revision then. */
export type BriefProposal = { brief: ClientBrief; basis: BriefBasis; revision: number };
type Props = {
  client: RecordItem; canEdit?: boolean; onSave?: (brief: ClientBrief, revision?: number) => Promise<boolean>;
  /** The AI writes a brief from the client's file, content plans, tasks, posts and feedback (/api/ai « brief »). */
  onGenerate?: () => Promise<BriefProposal>;
};

export default function ClientBriefBoard({ client, canEdit = false, onSave, onGenerate }: Props) {
  const { t } = useI18n();
  const brief = client.brief || emptyBrief(client.description || '');
  const [section, setSection] = useState<BriefSection | 'json' | null>(null);
  const [draft, setDraft] = useState(brief);
  const [revision, setRevision] = useState(client.revision);
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // « Remplir avec l’IA » runs in the background (features/workspace/background-work.tsx): the person can
  // leave this page meanwhile; the proposal waits here, for review, until they come back to this client.
  const jobKey = `brief:${client.id}`;
  const generating = !!useBackgroundJob(jobKey);
  const proposal = useBackgroundResult<BriefProposal>(jobKey) ?? null;
  const setProposal = (value: null) => { void value; clearResult(jobKey); };
  const here = useRef(true);
  useEffect(() => { here.current = true; return () => { here.current = false; }; }, []);
  const file = useRef<HTMLInputElement>(null);
  const filled = briefSections.filter((key) => briefHasContent(brief, key)).length;
  const open = (key: BriefSection | 'json') => {
    setDraft(structuredClone(brief)); setRevision(client.revision); setJson(JSON.stringify(brief, null, 2)); setError(''); setSection(key);
  };
  const patch = (changes: Partial<ClientBrief>) => setDraft((current) => ({ ...current, ...changes }));
  const identity = (changes: Partial<ClientBrief['identity']>) => setDraft((current) => ({ ...current, identity: { ...current.identity, ...changes } }));
  async function save() {
    if (!onSave || !canEdit || saving) return;
    let input: unknown = draft;
    if (section === 'json') {
      try { input = JSON.parse(json); } catch { setError(t('JSON invalide. Vérifiez les virgules et les guillemets.')); return; }
    }
    const parsed = parseBriefFile(input);
    if ('error' in parsed) { setError(t('Brief invalide : vérifiez « {field} ».', { field: parsed.path })); return; }
    setSaving(true); setError('');
    try {
      if (await onSave(parsed.brief, revision)) setSection(null);
      else setError(t('Enregistrement impossible. Vos modifications sont conservées.'));
    } catch { setError(t('Enregistrement impossible. Vos modifications sont conservées.')); }
    finally { setSaving(false); }
  }
  function generate() {
    if (!onGenerate || generating) return;
    setError('');
    runInBackground({
      key: jobKey, label: t('Brief de « {name} » par l’IA', { name: client.name }), work: onGenerate,
      // Still on this page: the review opens by itself. Elsewhere: a notice says where to find it.
      done: () => (here.current ? null : t('Le brief proposé pour « {name} » est prêt : il vous attend sur sa fiche.', { name: client.name })),
      failed: (e) => { if (here.current) { setError(t(e.message)); return null; } return `${client.name} : ${t(e.message)}`; },
    });
  }
  /** Saves the proposal: all of it, or only into the sections still empty. */
  async function apply(only: 'empty' | 'all') {
    if (!proposal || !onSave || saving) return;
    setSaving(true); setError('');
    try {
      if (await onSave(only === 'empty' ? fillEmptySections(brief, proposal.brief) : proposal.brief, proposal.revision)) setProposal(null);
      else setError(t('Enregistrement impossible. Le brief a peut-être changé entre-temps : relancez l’IA.'));
    } catch { setError(t('Enregistrement impossible. Le brief a peut-être changé entre-temps : relancez l’IA.')); }
    finally { setSaving(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `brief-${client.name.replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 80)}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(selected?: File) {
    if (!selected) return;
    if (selected.size > 256 * 1024) { setError(t('Le fichier JSON ne doit pas dépasser 256 Ko.')); return; }
    try {
      const value = await selected.text();
      const parsed = parseBriefFile(JSON.parse(value));
      if ('error' in parsed) { setError(t('Brief invalide : vérifiez « {field} ».', { field: parsed.path })); return; }
      setJson(JSON.stringify(parsed.brief, null, 2)); setRevision(client.revision); setSection('json'); setError('');
    } catch { setError(t('Impossible de lire ce fichier JSON.')); }
  }
  const field = (label: string, value: string, change: (value: string) => void, placeholder = '', multiline = true, max = 5000) => <label className={styles.field}>
    <span>{t(label)}</span>{multiline ? <textarea value={value} maxLength={max} rows={3} placeholder={t(placeholder)} onChange={(e) => change(e.target.value)} /> : <input value={value} maxLength={max} placeholder={t(placeholder)} onChange={(e) => change(e.target.value)} />}
  </label>;
  function preview(key: BriefSection, value: ClientBrief) {
    if (!briefHasContent(value, key)) return <p className={styles.placeholder}>{t(canEdit ? 'Cliquez pour définir cette direction.' : 'À compléter par le studio.')}</p>;
    if (key === 'identity') return <><div className={styles.swatches}>{value.identity.colors.map((color) => <span key={`${color.name}-${color.value}`} title={`${color.name} · ${color.value}`} style={{ background: color.value }} />)}</div><p>{value.identity.typography || value.identity.direction || value.identity.dos || value.identity.donts}</p></>;
    if (key === 'goals') return <ul>{value.goals.slice(0, 3).map((goal) => <li key={goal.id}>{goal.title}</li>)}</ul>;
    if (key === 'requirements') return <ul>{value.requirements.slice(0, 3).map((requirement) => <li key={requirement.id}>{requirement.priority === 'must' && <Check size={12} />}{requirement.text}</li>)}</ul>;
    if (key === 'references') return <ul>{value.references.slice(0, 3).map((reference) => <li key={reference.id}><Link2 size={12} />{reference.label}</li>)}</ul>;
    return <p>{key === 'audience' ? value.audience || value.voice : value.overview}</p>;
  }
  function readSection(key: BriefSection, value: ClientBrief = brief) {
    if (key === 'identity') return <div className={styles.readContent}>
      <div className={styles.colorList}>{value.identity.colors.map((color) => <div key={`${color.name}-${color.value}`}><i style={{ background: color.value }} /><span>{color.name}<small dir="ltr">{color.value}</small></span></div>)}</div>
      {[['Typographie', value.identity.typography], ['Direction visuelle', value.identity.direction], ['À privilégier', value.identity.dos], ['À éviter', value.identity.donts]].map(([label, text]) => text && <div key={label}><h3>{t(label)}</h3><p>{text}</p></div>)}
    </div>;
    if (key === 'goals') return <div className={styles.readContent}>{value.goals.map((goal, i) => <div key={goal.id}><h3>{String(i + 1).padStart(2, '0')} · {goal.title}</h3><p>{goal.measure}</p></div>)}</div>;
    if (key === 'requirements') return <div className={styles.readContent}>{value.requirements.map((requirement) => <div key={requirement.id}><span className={styles.tag}>{t(requirement.priority === 'must' ? 'Indispensable' : 'Préférence')}</span><p>{requirement.text}</p></div>)}</div>;
    if (key === 'references') return <div className={styles.readContent}>{value.references.map((reference) => <a key={reference.id} href={reference.url} target="_blank" rel="noopener noreferrer">{reference.label}<ArrowUpRight size={16} /></a>)}</div>;
    return <div className={styles.readContent}>{key === 'audience' ? <><h3>{t('Audience cible')}</h3><p>{value.audience || '—'}</p><h3>{t('Ton de voix')}</h3><p>{value.voice || '—'}</p></> : <p>{value.overview || t('À compléter par le studio.')}</p>}</div>;
  }
  const basisLine = (b: BriefBasis) => b.months || b.tasks || b.posts
    ? t('Sources — mois de plan éditorial : {months} · contenus prévus : {ideas} · tâches : {tasks} · publications : {posts} · demandes : {requests} · retours du client : {feedback}.', b)
    : t('Il n’y a encore ni plan éditorial, ni tâche, ni publication pour ce client : ce brief ne repose que sur sa fiche.');
  return <section className={styles.brief} aria-label={t('Brief de marque')}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>{t('DIRECTION CRÉATIVE')}</span><h2>{t('Brief de marque')}<span className={styles.tag}>{filled}/6</span></h2><p>{t('Une vision commune, de l’identité aux contenus.')}</p></div>
      <div className={styles.tools}>
        {canEdit && onGenerate && <button className="btn primary" disabled={generating} onClick={() => void generate()}>{generating ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}{t('Remplir avec l’IA')}</button>}
        {canEdit && <><button className="btn" onClick={() => file.current?.click()}><FileUp size={15} />{t('Importer')}</button><input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /><button className="btn" onClick={() => open('json')}><Braces size={15} />JSON</button></>}
        <button className="btn" onClick={download}><Download size={15} />{t('Exporter')}</button>
      </div>
    </header>
    {generating && <p className={styles.notice} role="status"><Loader2 size={15} className="spin" />{t('L’IA lit la fiche, le plan éditorial, les tâches, les publications et les retours du client…')}</p>}
    {error && !section && !proposal && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.map}>
      <Surface asChild tone="gold"><div className={styles.hub}>
        <ClientMark name={client.name} logo={client.logo} size="xl" />
        <span className={styles.eyebrow}>{t('LA VISION')}</span><h3>{client.name}</h3><p>{client.sector || t('Votre univers de marque')}</p>
        <div className={styles.progress} role="progressbar" aria-label={t('Sections renseignées')} aria-valuenow={filled} aria-valuemin={0} aria-valuemax={6}><i style={{ width: `${filled / 6 * 100}%` }} /></div>
        <small>{t('{n} / 6 directions définies', { n: filled })}</small>
        {canEdit && <button className="btn primary" onClick={() => open(briefSections.find((key) => !briefHasContent(brief, key)) || 'overview')}><PenLine size={14} />{t(filled === 6 ? 'Affiner le brief' : 'Compléter le brief')}</button>}
      </div></Surface>
      {briefSections.map((key, i) => { const Icon = icons[key]; const complete = briefHasContent(brief, key); return <Surface asChild tone="default" key={key}><button className={`${styles.node} ${styles[key]}`} onClick={() => open(key)}>
        <span className={styles.nodeTop}><span className={styles.icon}><Icon size={19} /></span><span className={styles.number}>{String(i + 1).padStart(2, '0')}</span><ArrowUpRight size={15} /></span>
        <h3>{t(briefSectionLabels[key])}</h3><div className={styles.preview}>{preview(key, brief)}</div>
        <span className={styles.nodeFooter}>{t(complete ? 'Explorer' : canEdit ? 'Définir' : 'Consulter')}<span>{complete ? <Check size={13} /> : <Plus size={13} />}</span></span>
      </button></Surface>; })}
    </div>
    <Dialog open={!!proposal} onOpenChange={(value) => { if (!value && !saving) { setProposal(null); setError(''); } }}>
      <DialogContent className={styles.dialog} onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onInteractOutside={(event) => { if (saving) event.preventDefault(); }} showCloseButton={!saving}>
        <DialogHeader><DialogTitle>{t('Brief proposé par l’IA')}</DialogTitle><DialogDescription>{proposal && basisLine(proposal.basis)}</DialogDescription></DialogHeader>
        {proposal && <div className={styles.proposal}>
          <p className={styles.notice}>{t('Relisez-le : l’IA ne connaît que ce que contient l’application. Les points incertains sont marqués « à confirmer », et rien n’est enregistré avant votre choix.')}</p>
          {briefSections.filter((key) => briefHasContent(proposal.brief, key)).map((key) => <section key={key}><h3 className={styles.proposalTitle}>{t(briefSectionLabels[key])}{briefHasContent(brief, key) && <span className={styles.tag}>{t('déjà rempli')}</span>}</h3>{readSection(key, proposal.brief)}</section>)}
        </div>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <DialogFooter>
          <button className="btn" disabled={saving} onClick={() => { setProposal(null); setError(''); }}>{t('Annuler')}</button>
          <button className="btn" disabled={saving} onClick={() => { if (!proposal) return; setJson(JSON.stringify(proposal.brief, null, 2)); setRevision(proposal.revision); setProposal(null); setError(''); setSection('json'); }}><Braces size={15} />{t('Modifier en JSON')}</button>
          {filled > 0 && filled < 6 && <button className="btn" disabled={saving} onClick={() => void apply('empty')}>{t('Compléter les sections vides')}</button>}
          <button className="btn primary" disabled={saving} onClick={() => void apply('all')}>{saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}{t(filled ? 'Remplacer le brief' : 'Enregistrer le brief')}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!section} onOpenChange={(value) => { if (!value && !saving) { setSection(null); setError(''); } }}>
      <DialogContent className={styles.dialog} onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onInteractOutside={(event) => { if (saving) event.preventDefault(); }} showCloseButton={!saving}>
        <DialogHeader><DialogTitle>{section === 'json' ? t('Brief JSON') : section ? t(briefSectionLabels[section]) : ''}</DialogTitle><DialogDescription>{section === 'json' ? t('Importez ou modifiez le brief, puis enregistrez pour mettre à jour la carte.') : t('La direction créative de {name}', { name: client.name })}</DialogDescription></DialogHeader>
        {section === 'json' ? <><textarea className={styles.json} disabled={saving} dir="ltr" spellCheck={false} value={json} maxLength={256 * 1024} onChange={(e) => setJson(e.target.value)} aria-label={t('Brief JSON')} /><a className="text-link" href="/brief-marque-modele.json" download><Download size={14} />{t('Télécharger un modèle')}</a></> : section && !canEdit ? readSection(section) : <fieldset disabled={saving} className={styles.form}>
          {section === 'overview' && field('La marque', draft.overview, (overview) => patch({ overview }), 'Histoire, positionnement, promesse et contexte…', true, 15000)}
          {section === 'audience' && <>{field('Audience cible', draft.audience, (audience) => patch({ audience }), 'À qui parle-t-on ? Besoins, habitudes, motivations…')}{field('Ton de voix', draft.voice, (voice) => patch({ voice }), 'Comment la marque s’exprime-t-elle ?')}</>}
          {section === 'identity' && <>
            <h3>{t('Palette de couleurs')}</h3><div className={styles.colors}>{draft.identity.colors.map((color, index) => <div className={styles.colorRow} key={index}>
              <input type="color" aria-label={t('Couleur {n}', { n: index + 1 })} value={color.value} onChange={(e) => identity({ colors: draft.identity.colors.map((item, i) => i === index ? { ...item, value: e.target.value } : item) })} />
              <input aria-label={t('Nom de couleur {n}', { n: index + 1 })} placeholder={t('Nom de la couleur')} maxLength={80} value={color.name} onChange={(e) => identity({ colors: draft.identity.colors.map((item, i) => i === index ? { ...item, name: e.target.value } : item) })} />
              <code>{color.value}</code><button className="icon-button" aria-label={t('Supprimer la couleur')} onClick={() => identity({ colors: draft.identity.colors.filter((_, i) => i !== index) })}><Trash2 size={15} /></button>
            </div>)}</div>
            {draft.identity.colors.length < 8 && <button className="btn" onClick={() => identity({ colors: [...draft.identity.colors, { name: '', value: '#E5B95C' }] })}><Plus size={14} />{t('Ajouter une couleur')}</button>}
            {field('Typographie', draft.identity.typography, (typography) => identity({ typography }), 'Polices, titres, corps de texte…', false, 500)}
            {field('Direction visuelle', draft.identity.direction, (direction) => identity({ direction }), 'Photos, compositions, textures, usage du logo…')}
            <div className={styles.twoColumns}>{field('À privilégier', draft.identity.dos, (dos) => identity({ dos }))}{field('À éviter', draft.identity.donts, (donts) => identity({ donts }))}</div>
          </>}
          {section === 'goals' && <>{draft.goals.map((goal, index) => <Surface asChild tone="subtle" key={goal.id}><div className={styles.entry}><div className={styles.entryHead}><span>{t('Objectif {n}', { n: index + 1 })}</span><button className="icon-button" aria-label={t('Supprimer l’objectif')} onClick={() => patch({ goals: draft.goals.filter((item) => item.id !== goal.id) })}><Trash2 size={15} /></button></div>{field('Objectif', goal.title, (title) => patch({ goals: draft.goals.map((item) => item.id === goal.id ? { ...item, title } : item) }), 'Le résultat que la marque recherche…', false, 300)}{field('Critère de réussite', goal.measure, (measure) => patch({ goals: draft.goals.map((item) => item.id === goal.id ? { ...item, measure } : item) }), 'Indicateur, cible, échéance…', false, 500)}</div></Surface>)}{draft.goals.length < 20 && <button className="btn" onClick={() => patch({ goals: [...draft.goals, { id: crypto.randomUUID(), title: '', measure: '' }] })}><Plus size={14} />{t('Ajouter un objectif')}</button>}</>}
          {section === 'requirements' && <>{draft.requirements.map((requirement, index) => <Surface asChild tone="subtle" key={requirement.id}><div className={styles.entry}><div className={styles.entryHead}><span>{t('Exigence {n}', { n: index + 1 })}</span><button className="icon-button" aria-label={t('Supprimer l’exigence')} onClick={() => patch({ requirements: draft.requirements.filter((item) => item.id !== requirement.id) })}><Trash2 size={15} /></button></div>{field('Exigence', requirement.text, (text) => patch({ requirements: draft.requirements.map((item) => item.id === requirement.id ? { ...item, text } : item) }), 'Contraintes, mentions, formats, délais…', true, 1000)}<div className={styles.priority} role="group" aria-label={t('Priorité de l’exigence')}>{(['must', 'prefer'] as const).map((priority) => <button key={priority} aria-pressed={requirement.priority === priority} onClick={() => patch({ requirements: draft.requirements.map((item) => item.id === requirement.id ? { ...item, priority } : item) })}>{t(priority === 'must' ? 'Indispensable' : 'Préférence')}</button>)}</div></div></Surface>)}{draft.requirements.length < 30 && <button className="btn" onClick={() => patch({ requirements: [...draft.requirements, { id: crypto.randomUUID(), text: '', priority: 'must' }] })}><Plus size={14} />{t('Ajouter une exigence')}</button>}</>}
          {section === 'references' && <>{draft.references.map((reference) => <Surface asChild tone="subtle" key={reference.id}><div className={styles.entry}><div className={styles.entryHead}><Link2 size={15} /><button className="icon-button" aria-label={t('Supprimer la référence')} onClick={() => patch({ references: draft.references.filter((item) => item.id !== reference.id) })}><Trash2 size={15} /></button></div>{field('Titre', reference.label, (label) => patch({ references: draft.references.map((item) => item.id === reference.id ? { ...item, label } : item) }), '', false, 160)}{field('Lien', reference.url, (url) => patch({ references: draft.references.map((item) => item.id === reference.id ? { ...item, url } : item) }), 'https://…', false, 2000)}</div></Surface>)}{draft.references.length < 20 && <button className="btn" onClick={() => patch({ references: [...draft.references, { id: crypto.randomUUID(), label: '', url: '' }] })}><Plus size={14} />{t('Ajouter une référence')}</button>}</>}
        </fieldset>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <DialogFooter><button className="btn" disabled={saving} onClick={() => { setSection(null); setError(''); }}>{t(canEdit ? 'Annuler' : 'Fermer')}</button>{canEdit && <button className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}{t('Enregistrer le brief')}</button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
