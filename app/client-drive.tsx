'use client';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, Cloud, Code2, Download, ExternalLink, File, FileImage, FileVideo, Folder, FolderOpen, FolderPlus, Loader2, Move, Pencil, Plus, RefreshCw, RotateCcw, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/app/locale-provider';
import DriveSettings from '@/app/drive-settings';
import { driveFetch, chooseDriveFiles } from '@/app/drive-client';
import { folderBlueprintSchema, folderMime, folderNameSchema, orderedFolders, rootFolderId, type ClientFolderPlan, type DriveConnectionView, type DriveFile, type FolderBlueprint, type FolderNode } from '@/lib/client-folders';
import styles from '@/app/client-drive.module.css';
import { formatTimestamp } from '@/lib/time';

type PlanResult = { plan: ClientFolderPlan | null; connection: DriveConnectionView };
type Listing = { files: DriveFile[]; nextPageToken?: string; folder: DriveFile; root: { id: string; name: string }; refreshedAt: string };
type Modal = { kind: 'create' | 'regenerate' | 'json' | 'folder' | 'rename' | 'move' | 'trash' | 'remove-node'; file?: DriveFile; node?: FolderNode; requestId: string };
type UploadState = { file: globalThis.File; requestId: string; parentId: string; replaceId?: string; percent: number; paused: boolean };
const freshTree = (name: string): FolderBlueprint => ({ version: 1, title: name.replace(/[\u0000-\u001f/\\]/g, '-').slice(0, 160).trim() || 'Client', summary: '', nodes: [{ id: 'root', parentId: null, name: name.replace(/[\u0000-\u001f/\\]/g, '-').slice(0, 160).trim() || 'Client', purpose: '' }] });
const downloadJson = (tree: FolderBlueprint) => { const url = URL.createObjectURL(new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `${tree.title.replace(/[^\p{L}\p{N}_-]/gu, '-')}-folders.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };

export default function ClientDrive({ workspaceId, clientId, clientName, owner, archived = false }: { workspaceId: string; clientId: string; clientName: string; owner: boolean; archived?: boolean }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<PlanResult | null>(null); const [tree, setTree] = useState(() => freshTree(clientName));
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [view, setView] = useState<'plan' | 'files'>('plan'); const [dirty, setDirty] = useState(false); const [selected, setSelected] = useState('root');
  const [modal, setModal] = useState<Modal | null>(null); const [json, setJson] = useState(''); const [modalError, setModalError] = useState('');
  const [creating, setCreating] = useState(false); const alive = useRef(true); const stopCreate = useRef(false); const importInput = useRef<HTMLInputElement>(null);
  const rootId = rootFolderId(data?.plan ?? null); const locked = !!data?.plan?.binding;
  const apply = useCallback((result: PlanResult) => { setData(result); if (result.plan) { setTree(result.plan.blueprint); setSelected(result.plan.blueprint.nodes.find((n) => n.parentId === null)!.id); } setDirty(false); }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try { const result = await driveFetch<PlanResult>(workspaceId, `plan?${new URLSearchParams({ clientId })}`, undefined, signal); if (!signal?.aborted) { apply(result); setView(rootFolderId(result.plan) ? 'files' : 'plan'); } }
    catch (e) { if (!signal?.aborted) setError((e as Error).message); } finally { if (!signal?.aborted) setLoading(false); }
  }, [workspaceId, clientId, apply]);
  // The effect starts an external request; loading state also supports explicit user refreshes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { alive.current = true; const controller = new AbortController(); void load(controller.signal); return () => { alive.current = false; stopCreate.current = true; controller.abort(); }; }, [load]);
  // Consume the OAuth browser redirect once, with its result visible in this client workspace.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const url = new URL(window.location.href); const message = url.searchParams.get('driveError'); if (message) setError(message); if (url.searchParams.has('driveConnected')) setNotice('Google Drive connecté. Choisissez maintenant le dossier agence.'); if (message || url.searchParams.has('driveConnected')) { url.searchParams.delete('driveError'); url.searchParams.delete('driveConnected'); window.history.replaceState(null, '', url); } }, [t]);
  function edit(next: FolderBlueprint) { setTree(next); setDirty(true); setNotice(''); }
  function open(kind: Modal['kind'], file?: DriveFile, node?: FolderNode) { setModal({ kind, file, node, requestId: crypto.randomUUID() }); setJson(JSON.stringify(tree, null, 2)); setModalError(''); }
  async function save(): Promise<ClientFolderPlan> {
    const result = await driveFetch<{ plan: ClientFolderPlan }>(workspaceId, 'plan', { action: 'save', clientId, revision: data?.plan?.revision ?? 0, blueprint: tree });
    setData((d) => d ? { ...d, plan: result.plan } : d); setTree(result.plan.blueprint); setDirty(false); return result.plan;
  }
  async function saveClick() { setBusy('save'); setError(''); try { await save(); setNotice('Organisation enregistrée.'); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } }
  async function generate() {
    setModal(null); setBusy('generate'); setError(''); setNotice('');
    try { const result = await driveFetch<{ plan: ClientFolderPlan }>(workspaceId, 'plan', { action: 'generate', clientId, revision: data?.plan?.revision ?? 0, language: locale }); setData((d) => d ? { ...d, plan: result.plan } : d); setTree(result.plan.blueprint); setSelected(result.plan.blueprint.nodes.find((n) => n.parentId === null)!.id); setDirty(false); setNotice('Plan généré depuis le brief. Vérifiez-le avant de créer les dossiers.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function create() {
    setModal(null); setCreating(true); stopCreate.current = false; setError(''); setNotice('');
    try {
      let plan = !data?.plan || dirty ? await save() : data.plan;
      while (plan.done.length < plan.blueprint.nodes.length && !stopCreate.current && alive.current) {
        const result = await driveFetch<{ plan: ClientFolderPlan }>(workspaceId, 'plan', { action: 'create', clientId, revision: plan.revision });
        plan = result.plan; if (alive.current) setData((d) => d ? { ...d, plan } : d);
      }
      if (alive.current && plan.done.length === plan.blueprint.nodes.length) { setView('files'); setNotice('Les dossiers ont été créés dans Google Drive.'); }
    } catch (e) { if (alive.current) { setError((e as Error).message); const latest = await driveFetch<PlanResult>(workspaceId, `plan?${new URLSearchParams({ clientId })}`).catch(() => null); if (latest) apply(latest); } }
    finally { if (alive.current) setCreating(false); }
  }
  async function importTree(file?: globalThis.File) {
    if (!file) return;
    try { if (file.size > 256_000) throw new Error(t('Le fichier JSON est trop volumineux.')); const result = folderBlueprintSchema.safeParse(JSON.parse(await file.text())); if (!result.success) throw new Error(result.error.issues[0].message); edit(result.data); setSelected(result.data.nodes.find((n) => n.parentId === null)!.id); }
    catch (e) { setError((e as Error).message); } finally { if (importInput.current) importInput.current.value = ''; }
  }
  const node = tree.nodes.find((n) => n.id === selected) ?? tree.nodes[0];
  const descendants = (id: string) => { const ids = new Set([id]); for (let i = 0; i < tree.nodes.length; i++) for (const n of tree.nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id); return ids; };
  function addNode() { const id = crypto.randomUUID(); edit({ ...tree, nodes: [...tree.nodes, { id, parentId: node.id, name: `${t('Nouveau dossier')} ${tree.nodes.length}`, purpose: '' }] }); setSelected(id); }
  const mutating = !!busy || creating || archived;
  if (loading) return <div className={styles.empty}><Loader2 className="spin" size={24} /><p>{t('Chargement des fichiers…')}</p></div>;
  return <div className={styles.page}>
    <div className={styles.hero}>
      <div className={styles.topline}><div className={styles.heading}><span className={styles.icon}><Cloud size={22} /></span><div><h2>{t('Espace fichiers')}</h2><p>{t('Du brief aux livrables, une organisation propre à ce client.')}</p></div></div><div className={styles.actions}><button type="button" className={`btn ${view === 'plan' ? 'primary' : ''}`} onClick={() => setView('plan')}>{t('Organisation')}</button><button type="button" className={`btn ${view === 'files' ? 'primary' : ''}`} disabled={!rootId} onClick={() => setView('files')}><FolderOpen size={16} />{t('Fichiers')}</button></div></div>
      <div className={styles.status}><span className={styles.pill}>{data?.connection.connected ? t('Drive connecté') : t('Drive non connecté')}</span>{data?.plan && <span>{t('{n} dossiers', { n: tree.nodes.length })}</span>}{dirty && <span>{t('Modifications non enregistrées')}</span>}{archived && <span>{t('Client archivé · lecture seule')}</span>}</div>
    </div>
    {error && <div className={styles.error} role="alert"><p>{t(error)}</p><button type="button" className="btn" disabled={mutating} onClick={() => void load()}><RefreshCw size={15} />{t('Actualiser')}</button></div>}
    {notice && <p className={styles.status} role="status"><Check size={16} />{t(notice)}</p>}
    {(!data?.connection.connected || !data.connection.root) && <DriveSettings workspaceId={workspaceId} clientId={clientId} owner={owner} initial={data?.connection} onChange={(c) => setData((d) => d ? { ...d, connection: c } : d)} />}
    {view === 'files' && rootId ? <DriveBrowser workspaceId={workspaceId} clientId={clientId} rootId={rootId} archived={archived} owner={owner} /> : <>
      <div className={styles.topline}><div><h3>{t('Architecture des dossiers')}</h3><p className={styles.summary}>{t('Le brief, les formats vendus et les sous-projets guident le plan. Ajustez-le puis créez les dossiers dans Drive.')}</p></div><div className={styles.actions}>
        {!locked && <button type="button" className="btn primary" disabled={mutating} onClick={() => data?.plan || dirty ? open('regenerate') : void generate()}>{busy === 'generate' ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}{t('Générer depuis le brief')}</button>}
        <button type="button" className="btn" disabled={creating} onClick={() => open('json')}><Code2 size={16} />JSON</button><button type="button" className="btn" onClick={() => downloadJson(tree)}><Download size={16} />{t('Exporter')}</button>
        {!locked && <><input ref={importInput} hidden type="file" accept="application/json,.json" onChange={(e) => void importTree(e.target.files?.[0])} /><button type="button" className="btn" disabled={mutating} onClick={() => importInput.current?.click()}><Upload size={16} />{t('Importer')}</button></>}
      </div></div>
      {tree.summary && <p className={styles.summary}>{tree.summary}</p>}
      {locked && <p className="small-note">{t('Ce plan décrit l’organisation initiale. Les changements effectués dans Drive apparaissent dans Fichiers.')}</p>}
      <div className={`${styles.layout} ${locked ? styles.full : ""}`}><div className={styles.panel}><div className={styles.tree} role="list" aria-label={t('Architecture des dossiers')}>
        {orderedFolders(tree).map((n) => { let depth = 0, parent = n.parentId; const seen = new Set<string>(); while (parent && !seen.has(parent)) { seen.add(parent); depth++; parent = tree.nodes.find((p) => p.id === parent)?.parentId ?? null; } return <div className={styles.node} role="listitem" key={n.id} style={{ '--depth': depth } as CSSProperties}><Folder size={18} /><div><strong>{n.name || '…'}</strong>{n.purpose && <small>{n.purpose}</small>}</div>{data?.plan?.done.includes(n.id) && <Check size={15} aria-label={t('Créé dans Drive')} />}{!locked && <button type="button" className="icon-button" aria-label={t('Modifier {name}', { name: n.name })} onClick={() => setSelected(n.id)}><Pencil size={15} /></button>}</div>; })}
      </div></div>
      {!locked && <aside className={`${styles.panel} ${styles.editor}`}><h3>{t('Modifier le dossier')}</h3><label>{t('Nom du dossier')}<input disabled={mutating} maxLength={160} value={node.name} onChange={(e) => edit({ ...tree, title: node.parentId === null ? e.target.value : tree.title, nodes: tree.nodes.map((n) => n.id === node.id ? { ...n, name: e.target.value } : n) })} /></label><label>{t('Utilisation')}<textarea disabled={mutating} maxLength={500} value={node.purpose} onChange={(e) => edit({ ...tree, nodes: tree.nodes.map((n) => n.id === node.id ? { ...n, purpose: e.target.value } : n) })} /></label>{node.parentId !== null && <label>{t('Dossier parent')}<select disabled={mutating} value={node.parentId} onChange={(e) => edit({ ...tree, nodes: tree.nodes.map((n) => n.id === node.id ? { ...n, parentId: e.target.value } : n) })}>{tree.nodes.filter((n) => !descendants(node.id).has(n.id)).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>}<button type="button" className="btn" disabled={mutating || tree.nodes.length >= 60} onClick={addNode}><Plus size={16} />{t('Ajouter un sous-dossier')}</button>{node.parentId !== null && <button type="button" className="btn ghost danger" disabled={mutating} onClick={() => open('remove-node', undefined, node)}><Trash2 size={16} />{t('Retirer du plan')}</button>}</aside>}
      </div>
      {creating && <div className={styles.progress} role="status"><span>{t('Création : {done}/{total} dossiers', { done: data?.plan?.done.length ?? 0, total: tree.nodes.length })}</span><progress value={data?.plan?.done.length ?? 0} max={tree.nodes.length} /><button type="button" className="btn" onClick={() => { stopCreate.current = true; }}>{t('Arrêter après ce groupe')}</button></div>}
      <div className={styles.actions}>{!locked && <button type="button" className="btn" disabled={mutating || (!dirty && !!data?.plan)} onClick={() => void saveClick()}><Check size={16} />{t('Enregistrer le plan')}</button>}{(!locked || (data?.plan?.done.length ?? 0) < tree.nodes.length) && <button type="button" className="btn primary" disabled={mutating || !data?.connection.root || !folderBlueprintSchema.safeParse(tree).success} onClick={() => open('create')}><Cloud size={16} />{t(locked ? 'Reprendre la création' : 'Créer dans Google Drive')}</button>}</div>
    </>}
    <Dialog open={!!modal} onOpenChange={(v) => { if (!v && !busy) setModal(null); }}><DialogContent className="tracker-modal"><DialogHeader><DialogTitle>{t(modal?.kind === 'json' ? 'Plan JSON' : modal?.kind === 'regenerate' ? 'Régénérer le plan ?' : modal?.kind === 'remove-node' ? 'Retirer ce dossier du plan ?' : 'Créer les dossiers dans Drive ?')}</DialogTitle><DialogDescription>{t(modal?.kind === 'json' ? 'Un format portable, modifiable avant la création dans Drive.' : modal?.kind === 'regenerate' ? 'Le nouveau plan remplacera le brouillon actuel. Les fichiers Drive ne seront pas modifiés.' : modal?.kind === 'remove-node' ? 'Ce dossier et ses sous-dossiers seront retirés du brouillon.' : 'Seuls les dossiers de ce plan seront créés dans le dossier agence choisi. Aucun fichier existant ne sera déplacé.')}</DialogDescription></DialogHeader>
      {modal?.kind === 'json' && <textarea className={styles.json} aria-label={t('Plan JSON')} value={json} readOnly={locked || archived} onChange={(e) => setJson(e.target.value)} spellCheck={false} />}
      {modal?.kind === 'create' && <p>{data?.connection.root?.name} → {tree.nodes.find((n) => n.parentId === null)?.name} · {t('{n} dossiers', { n: tree.nodes.length })}</p>}
      {modalError && <p className="form-error" role="alert">{modalError}</p>}
      <DialogFooter><button type="button" className="btn" onClick={() => setModal(null)}>{t('Annuler')}</button>{modal?.kind === 'json' ? !locked && !archived && <button type="button" className="btn primary" onClick={() => { try { const result = folderBlueprintSchema.safeParse(JSON.parse(json)); if (!result.success) throw new Error(result.error.issues[0].message); edit(result.data); setSelected(result.data.nodes.find((n) => n.parentId === null)!.id); setModal(null); } catch (e) { setModalError((e as Error).message); } }}>{t('Appliquer au plan')}</button> : <button type="button" className="btn primary" onClick={() => { if (modal?.kind === 'create') void create(); else if (modal?.kind === 'regenerate') void generate(); else if (modal?.node) { const ids = descendants(modal.node.id); edit({ ...tree, nodes: tree.nodes.filter((n) => !ids.has(n.id)) }); setSelected(tree.nodes.find((n) => n.parentId === null)!.id); setModal(null); } }}>{t('Confirmer')}</button>}</DialogFooter>
    </DialogContent></Dialog>
  </div>;
}

function DriveBrowser({ workspaceId, clientId, rootId, archived, owner }: { workspaceId: string; clientId: string; rootId: string; archived: boolean; owner: boolean }) {
  const { t, locale } = useI18n();
  const [listing, setListing] = useState<Listing | null>(null); const [path, setPath] = useState<{ id: string; name: string }[]>([{ id: rootId, name: t('Dossier client') }]); const folderId = path.at(-1)!.id;
  const [trash, setTrash] = useState(false); const [query, setQuery] = useState(''); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null); const [name, setName] = useState(''); const [modalError, setModalError] = useState('');
  const [upload, setUpload] = useState<UploadState | null>(null); const uploadInput = useRef<HTMLInputElement>(null); const replace = useRef<DriveFile | null>(null); const uploadController = useRef<AbortController | null>(null); const mounted = useRef(true);
  const [imports, setImports] = useState<{ id: string; name: string }[]>([]);
  const listingRef = useRef<Listing | null>(null); const listingSequence = useRef(0);
  const [targetPath, setTargetPath] = useState<{ id: string; name: string }[]>([]); const [targets, setTargets] = useState<DriveFile[]>([]); const [targetLoading, setTargetLoading] = useState(false);
  const load = useCallback(async (quiet = false, pageToken?: string, signal?: AbortSignal) => {
    const sequence = ++listingSequence.current;
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const requestPage = (token?: string) => driveFetch<Listing>(workspaceId, `files?${new URLSearchParams({ clientId, folderId, ...(trash ? { trash: '1' } : {}), ...(token ? { pageToken: token } : {}) })}`, undefined, signal);
      let data = await requestPage(pageToken);
      const expected = quiet && listingRef.current?.folder.id === folderId ? listingRef.current.files.length : 0;
      const seen = new Set<string>();
      while (quiet && data.nextPageToken && data.files.length < expected && !seen.has(data.nextPageToken) && sequence === listingSequence.current && !signal?.aborted) {
        seen.add(data.nextPageToken); const next = await requestPage(data.nextPageToken); data = { ...next, files: [...data.files, ...next.files] };
      }
      if (mounted.current && !signal?.aborted && sequence === listingSequence.current) {
        const old = listingRef.current; const next = pageToken && old ? { ...data, files: [...old.files, ...data.files].filter((f, i, all) => all.findIndex((x) => x.id === f.id) === i) } : data;
        listingRef.current = next; setListing(next); setError('');
      }
    } catch (e) { if (mounted.current && !signal?.aborted && sequence === listingSequence.current) setError((e as Error).message); }
    finally { if (mounted.current && !signal?.aborted && !quiet && sequence === listingSequence.current) setLoading(false); }
  }, [workspaceId, clientId, folderId, trash]);
  // Folder navigation starts an external request and cancels the previous folder's response.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { mounted.current = true; const controller = new AbortController(); void load(false, undefined, controller.signal); return () => { controller.abort(); }; }, [load]);
  useEffect(() => () => { mounted.current = false; uploadController.current?.abort(); }, []);
  useEffect(() => { if (busy || upload || modal) return; const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, 30_000); const refresh = () => { if (document.visibilityState === 'visible') void load(true); }; document.addEventListener('visibilitychange', refresh); return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); }; }, [load, busy, upload, modal]);
  const targetId = targetPath.at(-1)?.id;
  // The destination browser fetches a fresh listing rather than assuming the original plan is current.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (modal?.kind !== 'move' || !targetId) return; let alive = true; setTargetLoading(true); setModalError(''); void driveFetch<Listing>(workspaceId, `files?${new URLSearchParams({ clientId, folderId: targetId })}`).then((d) => { if (alive) setTargets(d.files.filter((f) => f.mimeType === folderMime && f.id !== modal.file?.id)); }).catch((e) => { if (alive) setModalError(e.message); }).finally(() => { if (alive) setTargetLoading(false); }); return () => { alive = false; }; }, [modal?.kind, modal?.file?.id, targetId, workspaceId, clientId]);
  function open(kind: Modal['kind'], file?: DriveFile) { setModal({ kind, file, requestId: crypto.randomUUID() }); setName(kind === 'rename' ? file!.name : ''); setModalError(''); if (kind === 'move') setTargetPath([{ id: rootId, name: listing?.root.name ?? t('Dossier client') }]); }
  async function act() {
    if (!modal) return; setBusy(true); setModalError('');
    try { const b = modal.kind === 'folder' ? { action: 'folder', parentId: folderId, name, requestId: modal.requestId } : modal.kind === 'rename' ? { action: 'rename', fileId: modal.file!.id, name } : modal.kind === 'move' ? { action: 'move', fileId: modal.file!.id, parentId: targetId } : { action: 'trash', fileId: modal.file!.id }; await driveFetch(workspaceId, 'files', { ...b, clientId }); setModal(null); await load(); }
    catch (e) { setModalError((e as Error).message); } finally { setBusy(false); }
  }
  async function restore(file: DriveFile) { setBusy(true); setError(''); try { await driveFetch(workspaceId, 'files', { action: 'restore', clientId, fileId: file.id }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function selectImports() { setBusy(true); setError(''); try { setImports(await chooseDriveFiles(workspaceId, locale, t('Sélectionner les fichiers à déplacer'))); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function importFiles() {
    setBusy(true); setError('');
    try { for (const file of imports) { await driveFetch(workspaceId, 'files', { action: 'import', clientId, parentId: folderId, fileId: file.id }); setImports((current) => current.filter((f) => f.id !== file.id)); } await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function runUpload(state: UploadState) {
    const controller = new AbortController(); uploadController.current = controller; setUpload({ ...state, paused: false }); setError('');
    try {
      const config = await driveFetch<{ uploadId: string; chunkSize: number }>(workspaceId, 'uploads', { clientId, parentId: state.parentId, name: state.file.name, mimeType: state.file.type || 'application/octet-stream', size: state.file.size, requestId: state.requestId, ...(state.replaceId ? { replaceId: state.replaceId } : {}) }, controller.signal);
      const status = () => driveFetch<{ done: boolean; offset: number }>(workspaceId, `uploads?${new URLSearchParams({ uploadId: config.uploadId })}`, undefined, controller.signal);
      let current = await status(); let retries = 0;
      while (!current.done && !controller.signal.aborted) {
        const start = current.offset; const chunk = state.file.slice(start, Math.min(start + config.chunkSize, state.file.size));
        const response = await fetch(`/api/drive/uploads?${new URLSearchParams({ uploadId: config.uploadId, offset: String(start) })}`, { method: 'PUT', headers: { 'X-Workspace-Id': workspaceId, 'Content-Type': 'application/octet-stream' }, body: chunk, signal: controller.signal });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || t('Transfert interrompu. Reprenez pour continuer.'));
        current = result;
        if (current.offset <= start && !current.done && ++retries > 2) throw new Error(t('Transfert interrompu. Reprenez pour continuer.'));
        if (current.offset > start) retries = 0;
        if (mounted.current) setUpload((u) => u ? { ...u, percent: Math.round(current.offset / state.file.size * 100) } : u);
      }
      if (mounted.current && current.done) { setUpload(null); await load(); }
    } catch (e) { if (mounted.current && !controller.signal.aborted) { setError((e as Error).message); setUpload((u) => u ? { ...u, paused: true } : u); } }
    finally { if (uploadController.current === controller) uploadController.current = null; }
  }
  function pickFile(file?: globalThis.File) { if (!file) return; const target = replace.current; replace.current = null; if (uploadInput.current) uploadInput.current.value = ''; if (!file.size || file.size > 1024 * 1024 * 1024) { setError(t('Fichier invalide : taille maximale 1 Go.')); return; } void runUpload({ file, requestId: crypto.randomUUID(), parentId: folderId, ...(target ? { replaceId: target.id } : {}), percent: 0, paused: false }); }
  const files = listing?.files.filter((f) => f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  const blocked = busy || !!upload || archived;
  const icon = (f: DriveFile) => f.mimeType === folderMime ? Folder : f.mimeType.startsWith('image/') ? FileImage : f.mimeType.startsWith('video/') ? FileVideo : File;
  const size = (f: DriveFile) => f.size ? `${(Number(f.size) / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} MB` : f.mimeType === folderMime ? t('Dossier') : f.mimeType.split('/').at(-1);
  const driveUrl = (f: DriveFile) => f.mimeType === folderMime ? `https://drive.google.com/drive/folders/${f.id}` : `https://drive.google.com/file/d/${f.id}/view`;
  return <section className={styles.panel}>
    <div className={styles.topline}><nav className={styles.breadcrumbs} aria-label={t('Dossiers')}>{path.map((p, i) => <span key={p.id}><button type="button" disabled={busy} onClick={() => { setPath(path.slice(0, i + 1)); setTrash(false); setQuery(''); }}>{i === 0 ? listing?.root.name ?? p.name : p.name}</button>{i < path.length - 1 && <ChevronRight size={14} />}</span>)}</nav><div className={styles.actions}><button type="button" className="btn" disabled={loading || busy} onClick={() => void load()}><RefreshCw className={loading ? 'spin' : ''} size={16} />{t('Actualiser')}</button>{listing && <a className="btn" href={driveUrl(listing.folder)} target="_blank" rel="noreferrer"><ExternalLink size={16} />{t('Ouvrir dans Drive')}</a>}</div></div>
    <div className={styles.toolbar}><label className={styles.searchBox}><span className="sr-only">{t('Rechercher dans ce dossier')}</span><input className={styles.search} placeholder={t('Rechercher dans ce dossier')} value={query} onChange={(e) => setQuery(e.target.value)} /></label><div className={styles.actions}><button type="button" className={`btn ${trash ? 'primary' : ''}`} disabled={busy} onClick={() => { setTrash(!trash); setQuery(''); }}><Trash2 size={16} />{t(trash ? 'Voir les fichiers' : 'Corbeille du dossier')}</button>{!trash && !archived && <><button type="button" className="btn" disabled={blocked || !listing?.folder.capabilities?.canAddChildren} onClick={() => open('folder')}><FolderPlus size={16} />{t('Nouveau dossier')}</button><button type="button" className="btn primary" disabled={blocked || !listing?.folder.capabilities?.canAddChildren} onClick={() => { replace.current = null; uploadInput.current?.click(); }}><Upload size={16} />{t('Ajouter un fichier')}</button></>}</div></div>
    {owner && !trash && !archived && <div className={styles.actions}><button type="button" className="btn" disabled={blocked} onClick={() => void selectImports()}><Cloud size={16} />{t('Importer depuis Drive')}</button><p className="small-note">{t('Sélectionnez les fichiers existants pour autoriser leur accès à l’application.')}</p></div>}
    {imports.length > 0 && <div className={styles.confirm}><strong>{t('Déplacer les fichiers sélectionnés ?')}</strong><p>{t('Ces fichiers seront déplacés de leur emplacement actuel vers ce dossier client. Vérifiez votre sélection avant de confirmer.')}</p><ul>{imports.map((f) => <li key={f.id}>{f.name}</li>)}</ul><div className={styles.actions}><button type="button" className="btn primary" disabled={busy || archived} onClick={() => void importFiles()}>{t('Confirmer le déplacement')}</button><button type="button" className="btn" disabled={busy} onClick={() => setImports([])}>{t('Annuler')}</button></div></div>}
    <input ref={uploadInput} type="file" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
    {error && <div className={styles.error} role="alert"><p>{t(error)}</p><button type="button" className="btn" onClick={() => void load()}>{t('Réessayer')}</button></div>}
    {upload && <div className={styles.progress} role="status"><span>{upload.file.name} · {upload.percent}%</span><progress value={upload.percent} max={100} /><div className={styles.actions}>{upload.paused && <button type="button" className="btn primary" onClick={() => void runUpload(upload)}><RotateCcw size={16} />{t('Reprendre le transfert')}</button>}<button type="button" className="btn" onClick={() => { uploadController.current?.abort(); setUpload(null); }}><X size={16} />{t('Arrêter le transfert')}</button></div></div>}
    {loading ? <div className={styles.empty}><Loader2 className="spin" size={24} /><p>{t('Chargement des fichiers…')}</p></div> : <>
      {!files.length ? <div className={styles.empty}>{query ? <Search size={28} /> : <FolderOpen size={28} />}<h3>{t(query ? 'Aucun résultat' : trash ? 'Corbeille vide' : 'Ce dossier est prêt')}</h3><p>{t(query ? 'Essayez un autre nom ou chargez la page suivante.' : trash ? 'Les fichiers supprimés dans ce dossier apparaîtront ici.' : 'Ajoutez vos sources, créations et livrables ici.')}</p></div> : <div className={styles.files}>{files.map((f) => { const Icon = icon(f); return <div className={styles.file} key={f.id}><div className={styles.fileName}><Icon size={22} /><div><button type="button" disabled={trash || busy || !!upload} onClick={() => f.mimeType === folderMime ? (setPath([...path, { id: f.id, name: f.name }]), setQuery('')) : window.open(driveUrl(f), '_blank', 'noopener,noreferrer')}>{f.name}</button><small>{size(f)}</small></div></div><span className={styles.date}>{f.modifiedTime ? formatTimestamp(f.modifiedTime, locale, { dateStyle: 'medium' }) : ''}</span><div className={styles.menu}>
        {trash ? !archived && <button type="button" className="btn" disabled={blocked || !f.capabilities?.canUntrash} onClick={() => void restore(f)}><RotateCcw size={15} />{t('Restaurer')}</button> : <>
          {f.mimeType !== folderMime && f.capabilities?.canDownload && <a className="icon-button" href={`/api/drive/download?${new URLSearchParams({ workspaceId, clientId, fileId: f.id })}`} aria-label={t('Télécharger {name}', { name: f.name })} title={t('Télécharger')}><Download size={16} /></a>}
          {!archived && <><button type="button" className="icon-button" disabled={blocked || !f.capabilities?.canEdit} aria-label={t('Renommer {name}', { name: f.name })} title={t('Renommer')} onClick={() => open('rename', f)}><Pencil size={16} /></button><button type="button" className="icon-button" disabled={blocked || !f.capabilities?.canEdit} aria-label={t('Déplacer {name}', { name: f.name })} title={t('Déplacer')} onClick={() => open('move', f)}><Move size={16} /></button>{f.mimeType !== folderMime && !f.mimeType.startsWith('application/vnd.google-apps.') && <button type="button" className="icon-button" disabled={blocked || !f.capabilities?.canEdit} aria-label={t('Remplacer {name}', { name: f.name })} title={t('Remplacer le fichier')} onClick={() => { replace.current = f; uploadInput.current?.click(); }}><Upload size={16} /></button>}<button type="button" className="icon-button danger" disabled={blocked || !f.capabilities?.canTrash} aria-label={t('Mettre {name} dans la corbeille', { name: f.name })} title={t('Corbeille')} onClick={() => open('trash', f)}><Trash2 size={16} /></button></>}
        </>}
      </div></div>; })}</div>}
      {listing?.nextPageToken && <button type="button" className="btn" onClick={() => void load(false, listing.nextPageToken)}>{t('Charger davantage')}</button>}
    </>}
    {listing && <p className={styles.status}><RefreshCw size={13} />{t('Actualisation automatique toutes les 30 secondes. Dernière mise à jour : {time}', { time: formatTimestamp(listing.refreshedAt, locale, { timeStyle: 'short' }) })}</p>}
    <Dialog open={!!modal} onOpenChange={(v) => { if (!v && !busy) setModal(null); }}><DialogContent className="tracker-modal"><DialogHeader><DialogTitle>{t(modal?.kind === 'folder' ? 'Nouveau dossier' : modal?.kind === 'rename' ? 'Renommer' : modal?.kind === 'move' ? 'Déplacer le fichier' : 'Mettre dans la corbeille ?')}</DialogTitle><DialogDescription>{modal?.file?.name || listing?.folder.name || ''}</DialogDescription></DialogHeader>
      {(modal?.kind === 'folder' || modal?.kind === 'rename') && <label className="form-field"><span>{t('Nom')}</span><input autoFocus maxLength={160} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} /></label>}
      {modal?.kind === 'trash' && <p>{t('Le fichier et les éventuels sous-dossiers pourront être restaurés depuis la corbeille. Aucun fichier ne sera supprimé définitivement.')}</p>}
      {modal?.kind === 'move' && <div><nav className={styles.breadcrumbs} aria-label={t('Destination')}>{targetPath.map((p, i) => <button key={p.id} type="button" disabled={busy} onClick={() => setTargetPath(targetPath.slice(0, i + 1))}>{p.name}</button>)}</nav>{targetLoading ? <Loader2 size={20} className="spin" /> : <div className={styles.tree}>{targets.map((f) => <button type="button" className="btn" key={f.id} disabled={busy} onClick={() => setTargetPath([...targetPath, { id: f.id, name: f.name }])}><Folder size={16} />{f.name}<ChevronRight size={14} /></button>)}</div>}<p className="small-note">{t('La destination doit rester dans le dossier de ce client.')}</p></div>}
      {modalError && <p className="form-error" role="alert">{t(modalError)}</p>}
      <DialogFooter><button type="button" className="btn" disabled={busy} onClick={() => setModal(null)}>{t('Annuler')}</button><button type="button" className={`btn ${modal?.kind === 'trash' ? 'danger' : 'primary'}`} disabled={busy || targetLoading || ((modal?.kind === 'folder' || modal?.kind === 'rename') && !folderNameSchema.safeParse(name).success)} onClick={() => void act()}>{busy && <Loader2 size={16} className="spin" />}{t(modal?.kind === 'move' ? 'Déplacer ici' : modal?.kind === 'trash' ? 'Mettre dans la corbeille' : 'Enregistrer')}</button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
