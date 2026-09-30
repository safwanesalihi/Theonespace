'use client';
// The Bibliothèque: the team's shared prompts, plugins, assets, presets and useful sites (lib/library.ts).
// Cards to browse — tabs with counts, search, tags, a client filter, favourites and the most used first —
// a side panel to read an entry in full (a prompt's blanks filled in before copying), and one « Ajouter »
// dialog where anything can be pasted: a link fills its own title and icon, a text becomes a prompt.
// Nothing is saved until « Enregistrer ». Everyone in the studio adds; the author, the owner and admins
// change or delete. The client portal never renders this page.
import { useMemo, useRef, useState } from 'react';
import {
  BookOpen, Check, Copy, CopyPlus, ExternalLink, Globe, Image as ImageIcon, Loader2, Pencil, Plug, Plus, Search, SlidersHorizontal, Sparkles, Star, Trash2, X,
} from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useI18n } from '@/app/locale-provider';
import { canManageEntry, cleanTags, fillPrompt, guessPaste, linkKey, promptTools, promptVariables } from '@/lib/library';
import { libraryCategories, safeLink, type LibraryCategory, type RecordItem } from '@/lib/model';
import type { WorkspaceRole } from '@/lib/workspace';

type Props = {
  records: RecordItem[];
  workspaceId: string;
  userId: string;
  userName: string;
  role: WorkspaceRole;
  busy: boolean;
  onChange: (body: unknown) => Promise<unknown>;
};

const categoryLabels: Record<LibraryCategory, string> = { prompt: 'Prompt', asset: 'Asset', plugin: 'Plugin', preset: 'Preset', website: 'Site web utile' };
const tabLabels: Record<LibraryCategory, string> = { prompt: 'Prompts', asset: 'Assets', plugin: 'Plugins', preset: 'Presets', website: 'Sites' };
const CategoryIcon = ({ category, size = 15 }: { category?: LibraryCategory; size?: number }) =>
  category === 'prompt' ? <Sparkles size={size} /> : category === 'plugin' ? <Plug size={size} /> : category === 'asset' ? <ImageIcon size={size} />
    : category === 'preset' ? <SlidersHorizontal size={size} /> : <Globe size={size} />;
type Sort = 'recent' | 'used' | 'name';
type Draft = {
  id?: string; revision?: number; name: string; category: LibraryCategory; content: string; link: string; description: string;
  tags: string[]; clientId: string; tool: string; example: string; icon: string;
};
const emptyDraft: Draft = { name: '', category: 'prompt', content: '', link: '', description: '', tags: [], clientId: '', tool: '', example: '', icon: '' };
const draftOf = (item: RecordItem): Draft => ({
  id: item.id, revision: item.revision, name: item.name, category: item.category || 'prompt', content: item.content || '', link: item.link || '',
  description: item.description || '', tags: item.tags ?? [], clientId: item.clientId || '', tool: item.tool || '', example: item.example || '', icon: item.icon || '',
});
/** A first name for a pasted prompt: its first line, cut at a word, without its blanks' braces. */
const shortName = (text: string) => {
  const line = text.split('\n')[0].replace(/[{}]/g, '').trim();
  return line.length <= 60 ? line : `${line.slice(0, 60).replace(/\s+\S*$/, '')}…`;
};
const host = (link?: string) => { try { return new URL(link || '').hostname.replace(/^www\./, ''); } catch { return ''; } };

/** A site's icon, or the category's when there is none or it does not load. */
function EntryIcon({ item, size = 18 }: { item: Pick<RecordItem, 'icon' | 'category'>; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`lib-icon ${item.category ?? 'prompt'}`} style={{ width: size + 14, height: size + 14 }}>
      {item.icon && !broken
        // eslint-disable-next-line @next/next/no-img-element -- a remote favicon of any size and host
        ? <img src={item.icon} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <CategoryIcon category={item.category} size={size - 2} />}
    </span>
  );
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    // Clipboard API refused (older browser, no permission): copy through a selected text field.
    const field = Object.assign(document.createElement('textarea'), { value: text });
    field.style.position = 'fixed'; field.style.opacity = '0';
    document.body.appendChild(field); field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  }
}

export default function LibraryPage({ records, workspaceId, userId, userName, role, busy, onChange }: Props) {
  const { t, date, rtl } = useI18n();
  const canAdd = role !== 'viewer' && role !== 'client';
  const [tab, setTab] = useState<'all' | 'favorites' | LibraryCategory>('all');
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [clientFilter, setClientFilter] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<RecordItem | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  // Copies and openings counted here at once; the server keeps the real count.
  const [used, setUsed] = useState<Record<string, number>>({});

  const all = useMemo(() => records.filter((r) => r.kind === 'library'), [records]);
  const clients = useMemo(() => records.filter((r) => r.kind === 'client' && !r.archived).sort((a, b) => a.name.localeCompare(b.name)), [records]);
  const clientName = (id?: string) => clients.find((c) => c.id === id)?.name ?? records.find((r) => r.id === id)?.name;
  const mine = (r: RecordItem) => !!r.favoriteBy?.includes(userId);
  const uses = (r: RecordItem) => (r.copies ?? 0) + (used[r.id] ?? 0);
  const allTags = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of all) for (const tag of r.tags ?? []) count.set(tag, (count.get(tag) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
  }, [all]);

  const words = query.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (r: RecordItem) => [r.name, r.content, r.link, r.description, r.tool, ...(r.tags ?? []), clientName(r.clientId)].join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Everything but the tab: the counts on the tabs follow the search and the filters.
  const matching = all.filter((r) => words.every((w) => hay(r).includes(w))
    && tags.every((tag) => r.tags?.some((x) => x.toLowerCase() === tag.toLowerCase()))
    && (!clientFilter || r.clientId === clientFilter));
  const inTab = (r: RecordItem, k: typeof tab) => (k === 'all' ? true : k === 'favorites' ? mine(r) : r.category === k);
  const items = matching.filter((r) => inTab(r, tab)).sort((a, b) =>
    Number(mine(b)) - Number(mine(a))
    || (sort === 'used' ? uses(b) - uses(a) : 0)
    || (sort === 'name' ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt)));
  const open = all.find((r) => r.id === openId) ?? null;
  const who = { userId, name: userName, role };

  function countUse(item: RecordItem) {
    setUsed((u) => ({ ...u, [item.id]: (u[item.id] ?? 0) + 1 }));
    void fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId }, body: JSON.stringify({ action: 'library-used', id: item.id }) }).catch(() => {});
  }
  async function copyEntry(item: RecordItem, text = item.content || '') {
    if (!(await copyText(text))) return;
    setCopied(item.id); setTimeout(() => setCopied(''), 1500);
    countUse(item);
  }
  async function star(item: RecordItem) {
    try { await onChange({ action: 'library-favorite', id: item.id, on: !mine(item) }); } catch (e) { setError(t((e as Error).message)); }
  }
  async function remove() {
    if (!removing) return;
    try {
      await onChange({ action: 'delete', kind: 'library', id: removing.id, revision: removing.revision });
      if (openId === removing.id) setOpenId(null);
      setRemoving(null);
    } catch (e) { setError(t((e as Error).message)); }
  }

  const tabs: ('all' | 'favorites' | LibraryCategory)[] = ['all', 'favorites', ...libraryCategories];
  const filtered = !!(query || tags.length || clientFilter);

  return <div className="library-page">
    <div className="page-heading">
      <span className="page-symbol" aria-hidden="true"><BookOpen size={22} /></span>
      <div className="heading-line">
        <h1>{t('Bibliothèque')}</h1>
        {canAdd && <button type="button" className="btn primary" onClick={() => setEditing({ ...emptyDraft })}><Plus size={15} />{t('Ajouter')}</button>}
      </div>
      <p>{t('Prompts, plugins, assets, presets et sites utiles partagés par l’équipe.')}</p>
    </div>

    <div className="lib-toolbar">
      <label className="lib-search">
        <Search size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Rechercher un prompt, un plugin, un tag…')} aria-label={t('Rechercher dans la bibliothèque')} />
        {query && <button type="button" className="icon-button" aria-label={t('Effacer')} onClick={() => setQuery('')}><X size={14} /></button>}
      </label>
      <select className="lib-select" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} aria-label={t('Client')}>
        <option value="">{t('Tous les clients')}</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select className="lib-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('Trier')}>
        <option value="recent">{t('Plus récents')}</option>
        <option value="used">{t('Plus utilisés')}</option>
        <option value="name">{t('De A à Z')}</option>
      </select>
    </div>

    <div className="lib-tabs" role="tablist">
      {tabs.map((k) => {
        const n = matching.filter((r) => inTab(r, k)).length;
        if (k === 'favorites' && !n && tab !== 'favorites') return null;
        return (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`quick-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {k === 'favorites' ? <Star size={13} /> : k !== 'all' ? <CategoryIcon category={k} size={13} /> : null}
            {t(k === 'all' ? 'Tout' : k === 'favorites' ? 'Favoris' : tabLabels[k])}<small>{n}</small>
          </button>
        );
      })}
    </div>
    {!!allTags.length && (
      <div className="lib-tags" aria-label={t('Tags')}>
        {allTags.slice(0, 16).map((tag) => {
          const on = tags.some((x) => x.toLowerCase() === tag.toLowerCase());
          return <button key={tag} type="button" className={`lib-tag${on ? ' on' : ''}`} aria-pressed={on} onClick={() => setTags((l) => (on ? l.filter((x) => x.toLowerCase() !== tag.toLowerCase()) : [...l, tag]))}>#{tag}</button>;
        })}
        {filtered && <button type="button" className="text-link" onClick={() => { setQuery(''); setTags([]); setClientFilter(''); }}>{t('Tout effacer')}</button>}
      </div>
    )}

    {error && <p className="form-error" role="alert">{error}</p>}

    {items.length ? (
      <div className="lib-grid">
        {items.map((item) => {
          const prompt = item.category === 'prompt';
          const blanks = prompt ? promptVariables(item.content).length : 0;
          return (
            <article key={item.id} className="lib-card">
              <button type="button" className="lib-card-open" onClick={() => setOpenId(item.id)} aria-label={t('Ouvrir « {name} »', { name: item.name })} />
              <header>
                <EntryIcon item={item} />
                <span className="lib-kind">{t(categoryLabels[item.category || 'prompt'])}{item.tool ? ` · ${item.tool}` : ''}</span>
                <button type="button" className={`lib-star${mine(item) ? ' on' : ''}`} aria-pressed={mine(item)} aria-label={t(mine(item) ? 'Retirer des favoris' : 'Ajouter aux favoris')} title={t(mine(item) ? 'Retirer des favoris' : 'Ajouter aux favoris')} onClick={() => void star(item)} disabled={busy}>
                  <Star size={15} />
                </button>
              </header>
              <h3 dir="auto">{item.name}</h3>
              {prompt
                ? <p className="lib-prompt" dir="auto">{item.content}</p>
                : <p className="lib-host">{host(item.link) || t('Aucun lien')}</p>}
              {item.description && !prompt && <p className="lib-desc" dir="auto">{item.description}</p>}
              {(!!item.tags?.length || item.clientId) && (
                <div className="lib-card-tags">
                  {item.clientId && <span className="lib-client">{clientName(item.clientId)}</span>}
                  {item.tags?.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}
                </div>
              )}
              <footer>
                <small>{item.author ? `${item.author} · ` : ''}{date(item.createdAt.slice(0, 10), { day: 'numeric', month: 'short' })}{uses(item) ? ` · ${t('{n} utilisations', { n: uses(item) })}` : ''}</small>
                {prompt
                  ? <button type="button" className="btn" onClick={() => (blanks ? setOpenId(item.id) : void copyEntry(item))}>
                      {copied === item.id ? <Check size={14} /> : <Copy size={14} />}{t(copied === item.id ? 'Copié' : blanks ? 'Remplir et copier' : 'Copier')}
                    </button>
                  : item.link && <a className="btn" href={safeLink(item.link)} target="_blank" rel="noopener noreferrer" onClick={() => countUse(item)}><ExternalLink size={14} />{t('Ouvrir')}</a>}
              </footer>
            </article>
          );
        })}
      </div>
    ) : (
      <div className="meetings-empty">
        <BookOpen size={26} />
        <strong>{t(all.length ? 'Aucun résultat' : 'Aucune ressource')}</strong>
        <p>{t(all.length ? 'Essayez un autre mot ou retirez un filtre.' : 'Ajoutez un premier prompt, plugin ou site utile pour l’équipe : collez simplement un lien ou un texte.')}</p>
        {canAdd && !all.length && <button type="button" className="btn primary" onClick={() => setEditing({ ...emptyDraft })}><Plus size={15} />{t('Ajouter')}</button>}
      </div>
    )}

    <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
      <SheetContent side={rtl ? 'left' : 'right'} className="peek-panel lib-panel" showCloseButton={false}>
        {open && <Preview key={open.id} item={open} clientName={clientName(open.clientId)} canManage={canManageEntry(open, who)} canAdd={canAdd} copied={copied === open.id}
          favorite={mine(open)} uses={uses(open)} busy={busy}
          onClose={() => setOpenId(null)} onCopy={(text) => void copyEntry(open, text)} onOpenLink={() => countUse(open)} onStar={() => void star(open)}
          onEdit={() => setEditing(draftOf(open))}
          onDuplicate={() => setEditing({ ...draftOf(open), id: undefined, revision: undefined, name: `${open.name} ${t('(copie)')}` })}
          onDelete={() => setRemoving(open)} />}
      </SheetContent>
    </Sheet>

    {editing && <Editor draft={editing} all={all} clients={clients} tagSuggestions={allTags} workspaceId={workspaceId} busy={busy} onChange={onChange}
      onShow={(id) => { setEditing(null); setOpenId(id); }}
      onClose={(id) => { setEditing(null); if (id) setOpenId(id); }} />}

    <AlertDialog open={!!removing} onOpenChange={(o) => { if (!o && !busy) setRemoving(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('Supprimer cette ressource ?')}</AlertDialogTitle><AlertDialogDescription>{t('« {name} » sera retiré de la bibliothèque pour toute l’équipe.', { name: removing?.name || '' })}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>{t('Annuler')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void remove(); }}>{t(busy ? 'Suppression…' : 'Supprimer')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

/** An entry in full: a prompt with its blanks to fill before copying, a link with its site, and the actions. */
function Preview({ item, clientName, canManage, canAdd, copied, favorite, uses, busy, onClose, onCopy, onOpenLink, onStar, onEdit, onDuplicate, onDelete }: {
  item: RecordItem; clientName?: string; canManage: boolean; canAdd: boolean; copied: boolean; favorite: boolean; uses: number; busy: boolean;
  onClose: () => void; onCopy: (text: string) => void; onOpenLink: () => void; onStar: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const { t, date } = useI18n();
  const prompt = item.category === 'prompt';
  const blanks = promptVariables(item.content);
  const [values, setValues] = useState<Record<string, string>>({});
  const text = fillPrompt(item.content || '', values);
  const history = (item.history ?? []).slice(-3).reverse();
  return <>
    <div className="peek-head">
      <span className="lib-kind"><EntryIcon item={item} size={14} />{t(categoryLabels[item.category || 'prompt'])}</span>
      <div className="inline">
        <button type="button" className={`lib-star${favorite ? ' on' : ''}`} aria-pressed={favorite} aria-label={t(favorite ? 'Retirer des favoris' : 'Ajouter aux favoris')} onClick={onStar} disabled={busy}><Star size={16} /></button>
        <button type="button" className="icon-button" aria-label={t('Fermer')} onClick={onClose}><X size={16} /></button>
      </div>
    </div>
    <div className="peek-body">
      <SheetTitle className="peek-title" dir="auto">{item.name}</SheetTitle>
      <SheetDescription className="lib-meta">
        {[item.author, date(item.createdAt.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' }), clientName, item.tool, uses ? t('{n} utilisations', { n: uses }) : ''].filter(Boolean).join(' · ')}
      </SheetDescription>
      {prompt ? <>
        {!!blanks.length && (
          <div className="lib-blanks">
            <strong>{t('À remplir avant de copier')}</strong>
            {blanks.map((b) => (
              <label key={b}><span>{b}</span><input value={values[b] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [b]: e.target.value }))} placeholder={`{${b}}`} /></label>
            ))}
          </div>
        )}
        <pre className="lib-full-prompt" dir="auto">{text}</pre>
        <div className="peek-actions">
          <button type="button" className="btn primary" onClick={() => onCopy(text)}>{copied ? <Check size={15} /> : <Copy size={15} />}{t(copied ? 'Copié' : 'Copier le prompt')}</button>
          {item.example && <a className="btn" href={safeLink(item.example)} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />{t('Voir un exemple')}</a>}
        </div>
      </> : item.link && <>
        <a className="lib-link-card" href={safeLink(item.link)} target="_blank" rel="noopener noreferrer" onClick={onOpenLink}>
          <EntryIcon item={item} size={22} />
          <span><b>{host(item.link)}</b><small>{item.link}</small></span>
          <ExternalLink size={15} />
        </a>
      </>}
      {item.description && <p className="peek-description" dir="auto">{item.description}</p>}
      {!!item.tags?.length && <div className="lib-card-tags">{item.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
      {(canManage || canAdd) && (
        <div className="peek-actions lib-panel-actions">
          {canManage && <button type="button" className="btn" onClick={onEdit}><Pencil size={14} />{t('Modifier')}</button>}
          {canAdd && <button type="button" className="btn" onClick={onDuplicate}><CopyPlus size={14} />{t('Dupliquer')}</button>}
          {canManage && <button type="button" className="btn danger" onClick={onDelete}><Trash2 size={14} />{t('Supprimer')}</button>}
        </div>
      )}
      {!canManage && canAdd && <small className="small-note">{t('Seuls son auteur, le propriétaire et les administrateurs peuvent la modifier : dupliquez-la pour en faire votre version.')}</small>}
      {!!history.length && (
        <ul className="lib-history">
          {history.map((h, i) => {
            const by = h.text.match(/^(Ajouté|Modifié) par (.+)$/);
            return <li key={i}>{by ? t(by[1] === 'Ajouté' ? 'Ajouté par {name}' : 'Modifié par {name}', { name: by[2] }) : t(h.text)} · {date(h.date.slice(0, 10), { day: 'numeric', month: 'short' })}</li>;
          })}
        </ul>
      )}
    </div>
  </>;
}

/** Tags typed with Enter or a comma, removable, with the library's own tags as suggestions. */
function TagInput({ value, onChange, suggestions }: { value: string[]; onChange: (tags: string[]) => void; suggestions: string[] }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const add = (raw: string) => { const next = cleanTags([...value, ...raw.split(',')]); onChange(next); setText(''); };
  return (
    <div className="lib-tag-input">
      {value.map((tag) => <span key={tag} className="lib-tag on">#{tag}<button type="button" aria-label={t('Retirer {tag}', { tag })} onClick={() => onChange(value.filter((x) => x !== tag))}><X size={11} /></button></span>)}
      <input list="lib-tag-suggestions" value={text} placeholder={value.length ? '' : t('Reel, Ramadan, Midjourney…')} aria-label={t('Tags')}
        onChange={(e) => { if (e.target.value.endsWith(',')) add(e.target.value); else setText(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) { e.preventDefault(); add(text); }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => { if (text.trim()) add(text); }} />
      <datalist id="lib-tag-suggestions">{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

/** « Ajouter » / « Modifier »: paste anything first; a link reads its own title and icon. Saved only on « Enregistrer ». */
function Editor({ draft: initial, all, clients, tagSuggestions, workspaceId, busy, onChange, onShow, onClose }: {
  draft: Draft; all: RecordItem[]; clients: RecordItem[]; tagSuggestions: string[]; workspaceId: string; busy: boolean;
  onChange: (body: unknown) => Promise<unknown>; onShow: (id: string) => void; onClose: (openId?: string) => void;
}) {
  const { t } = useI18n();
  const isNew = !initial.id;
  const [d, setD] = useState<Draft>(initial);
  const [started, setStarted] = useState(!isNew || !!initial.name);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [twin, setTwin] = useState<{ id: string; message: string } | null>(null);
  const lastRead = useRef('');
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const prompt = d.category === 'prompt';
  const blanks = promptVariables(d.content);
  // Known before saving: the same link already in the library.
  const dup = !prompt && d.link ? all.find((r) => r.id !== d.id && linkKey(r.link) === linkKey(d.link)) : undefined;

  async function readLink(link: string) {
    if (!/^https?:\/\/\S+\.\S+/i.test(link) || lastRead.current === link) return;
    lastRead.current = link;
    setReading(true);
    try {
      const r = await fetch('/api/library/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId }, body: JSON.stringify({ url: link }) });
      const p = (await r.json().catch(() => ({}))) as { title?: string; site?: string; icon?: string; description?: string };
      if (r.ok && lastRead.current === link) setD((x) => ({ ...x, name: x.name || p.title || p.site || '', icon: p.icon || '', description: x.description || p.description || '' }));
    } finally { setReading(false); }
  }
  function paste(text: string) {
    const g = guessPaste(text);
    if (!text.trim()) return;
    setStarted(true);
    if (g.link) { set({ category: g.category, link: g.link, content: '' }); void readLink(g.link); }
    else set({ category: 'prompt', content: g.content ?? '', name: d.name || shortName(g.content ?? '') });
  }
  async function save(allowDuplicate = false) {
    if (!d.name.trim()) { setError(t('Donnez-lui un nom.')); return; }
    if (prompt && !d.content.trim()) { setError(t('Écrivez le texte du prompt.')); return; }
    if (!prompt && !d.link.trim()) { setError(t('Collez le lien.')); return; }
    setError(''); setTwin(null);
    const data = {
      name: d.name.trim(), category: d.category, description: d.description.trim() || undefined, tags: d.tags, clientId: d.clientId || undefined,
      ...(prompt ? { content: d.content, tool: d.tool.trim() || undefined, example: d.example.trim() || undefined } : { link: d.link.trim(), icon: d.icon || undefined }),
    };
    try {
      const r = (await onChange(isNew ? { action: 'create', kind: 'library', data, allowDuplicate } : { action: 'update', kind: 'library', id: d.id, revision: d.revision, data, allowDuplicate })) as { id?: string };
      onClose(isNew ? r?.id : d.id);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'duplicate' && dup) setTwin({ id: dup.id, message: t('Ce lien existe déjà : « {name} ».', { name: dup.name }) });
      else setError(t(err.message));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="tracker-modal lib-editor">
        <DialogHeader>
          <DialogTitle>{t(isNew ? 'Ajouter à la bibliothèque' : 'Modifier la ressource')}</DialogTitle>
          <DialogDescription>{t(isNew ? 'Collez un lien ou un prompt : le reste se remplit tout seul.' : 'Rien n’est enregistré avant « Enregistrer ».')}</DialogDescription>
        </DialogHeader>
        {!started ? (
          <div className="lib-paste">
            <textarea autoFocus rows={5} placeholder={t('Collez ici un lien (plugin, site, asset…) ou le texte d’un prompt')} aria-label={t('Lien ou prompt')}
              onPaste={(e) => { const v = e.clipboardData.getData('text'); if (v.trim()) { e.preventDefault(); paste(v); } }}
              onChange={(e) => { if (/^https?:\/\/\S+$/i.test(e.target.value.trim())) paste(e.target.value); }}
              onBlur={(e) => { if (e.target.value.trim()) paste(e.target.value); }} />
            <button type="button" className="text-link" onClick={() => setStarted(true)}>{t('Ou remplir à la main')}</button>
          </div>
        ) : (
          <form className="lib-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="lib-cats" role="radiogroup" aria-label={t('Catégorie')}>
              {libraryCategories.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={d.category === c} className={`quick-chip${d.category === c ? ' on' : ''}`} onClick={() => set({ category: c })}>
                  <CategoryIcon category={c} size={13} />{t(categoryLabels[c])}
                </button>
              ))}
            </div>
            {prompt ? <>
              <label className="field"><span>{t('Texte du prompt')}</span>
                <textarea rows={8} value={d.content} onChange={(e) => set({ content: e.target.value })} dir="auto" placeholder={t('Écrivez {client} ou {produit} pour un blanc à remplir au moment de copier.')} />
              </label>
              {!!blanks.length && <p className="lib-hint">{t('Blancs à remplir :')} {blanks.map((b) => <code key={b}>{`{${b}}`}</code>)}</p>}
            </> : (
              <label className="field"><span>{t('Lien')}</span>
                <div className="lib-link-field">
                  {reading ? <Loader2 size={15} className="spin" /> : <EntryIcon item={{ icon: d.icon, category: d.category }} size={14} />}
                  <input type="url" value={d.link} placeholder="https://…" onChange={(e) => set({ link: e.target.value, icon: e.target.value === d.link ? d.icon : '' })} onBlur={(e) => void readLink(e.target.value.trim())} />
                </div>
                {dup && <small className="lib-warn">{t('Ce lien existe déjà : « {name} ».', { name: dup.name })} <button type="button" className="text-link" onClick={() => onShow(dup.id)}>{t('Voir')}</button></small>}
              </label>
            )}
            <label className="field"><span>{t('Nom')}</span><input value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={160} dir="auto" placeholder={t(reading ? 'Lecture du lien…' : 'Un nom court et clair')} /></label>
            {prompt && (
              <div className="lib-row">
                <label className="field"><span>{t('Outil IA')}</span>
                  <input list="lib-tools" value={d.tool} onChange={(e) => set({ tool: e.target.value })} maxLength={40} placeholder="ChatGPT, Midjourney…" />
                  <datalist id="lib-tools">{promptTools.map((x) => <option key={x} value={x} />)}</datalist>
                </label>
                <label className="field"><span>{t('Exemple de résultat (lien)')}</span><input type="url" value={d.example} onChange={(e) => set({ example: e.target.value })} placeholder="https://…" /></label>
              </div>
            )}
            <label className="field"><span>{t('Description')}</span><textarea rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} dir="auto" placeholder={t('À quoi ça sert, quand l’utiliser…')} /></label>
            <div className="lib-row">
              <label className="field"><span>{t('Tags')}</span><TagInput value={d.tags} onChange={(tags) => set({ tags })} suggestions={tagSuggestions} /></label>
              <label className="field"><span>{t('Client (facultatif)')}</span>
                <select value={d.clientId} onChange={(e) => set({ clientId: e.target.value })}>
                  <option value="">{t('Aucun : pour tous')}</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            </div>
            {twin && (
              <p className="lib-warn" role="alert">{twin.message} <button type="button" className="text-link" onClick={() => onShow(twin.id)}>{t('Voir')}</button> · <button type="button" className="text-link" onClick={() => void save(true)}>{t('Ajouter quand même')}</button></p>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => onClose()} disabled={busy}>{t('Annuler')}</button>
              <button type="submit" className="btn primary" disabled={busy || reading}>{busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}{t('Enregistrer')}</button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
