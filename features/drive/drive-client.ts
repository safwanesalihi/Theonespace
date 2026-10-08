'use client';
export async function driveFetch<T>(workspaceId: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/drive/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Workspace-Id': workspaceId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Drive ne répond pas pour le moment. Réessayez.');
  return data;
}

type PickerResponse = { action: string; docs?: { id: string; name: string; mimeType?: string }[] };
type View = { setIncludeFolders(v: boolean): View; setSelectFolderEnabled(v: boolean): View; setEnableDrives(v: boolean): View; setMimeTypes(v: string): View };
type Picker = { setVisible(v: boolean): void; dispose(): void };
type Builder = { setOAuthToken(v: string): Builder; setDeveloperKey(v: string): Builder; setAppId(v: string): Builder; setOrigin(v: string): Builder; setTitle(v: string): Builder; setLocale(v: string): Builder; addView(v: View): Builder; enableFeature(v: string): Builder; setCallback(v: (r: PickerResponse) => void): Builder; build(): Picker };
type GoogleBrowser = { gapi?: { load(name: string, opts: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }): void }; google?: { picker?: { DocsView: new(v: string) => View; ViewId: { FOLDERS: string; DOCS: string }; PickerBuilder: new() => Builder; Feature: { SUPPORT_DRIVES: string; MULTISELECT_ENABLED: string } } } };
let pickerScript: Promise<void> | undefined;
async function loadPicker() {
  const global = window as Window & GoogleBrowser;
  if (global.google?.picker) return;
  pickerScript ??= new Promise<void>((resolve, reject) => {
    function load() { global.gapi?.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker ne répond pas. Réessayez.')), timeout: 15_000, ontimeout: () => reject(new Error('Google Picker ne répond pas. Réessayez.')) }); }
    if (global.gapi) return load();
    const script = document.createElement('script'); script.src = 'https://apis.google.com/js/api.js'; script.async = true;
    script.onload = load; script.onerror = () => { script.remove(); reject(new Error('Google Picker ne répond pas. Réessayez.')); }; document.head.appendChild(script);
  }).catch((e) => { pickerScript = undefined; throw e; });
  await pickerScript;
}
export async function chooseDriveRoot(workspaceId: string, locale: string, title: string): Promise<string | null> {
  const config = await driveFetch<{ accessToken: string; key: string; projectNumber: string }>(workspaceId, 'connection', { action: 'picker' });
  await loadPicker();
  const api = (window as Window & GoogleBrowser).google!.picker!;
  return new Promise((resolve) => {
    // setEnableDrives(true) restricts a view to shared drives. Keep a regular
    // Drive view first so folders in personal accounts remain selectable.
    const view = new api.DocsView(api.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder');
    const sharedView = new api.DocsView(api.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setEnableDrives(true).setMimeTypes('application/vnd.google-apps.folder');
    const picker = new api.PickerBuilder().setOAuthToken(config.accessToken).setDeveloperKey(config.key).setAppId(config.projectNumber).setOrigin(window.location.origin).setTitle(title).setLocale(locale).enableFeature(api.Feature.SUPPORT_DRIVES).addView(view).addView(sharedView).setCallback((result) => {
      if (result.action === 'picked' || result.action === 'cancel') { resolve(result.action === 'picked' ? result.docs?.[0]?.id ?? null : null); picker.dispose(); }
    }).build();
    picker.setVisible(true);
  });
}
export async function chooseDriveFiles(workspaceId: string, locale: string, title: string): Promise<{ id: string; name: string }[]> {
  const config = await driveFetch<{ accessToken: string; key: string; projectNumber: string }>(workspaceId, 'connection', { action: 'picker' });
  await loadPicker();
  const api = (window as Window & GoogleBrowser).google!.picker!;
  return new Promise((resolve) => {
    const view = new api.DocsView(api.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
    const sharedView = new api.DocsView(api.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false).setEnableDrives(true);
    const picker = new api.PickerBuilder().setOAuthToken(config.accessToken).setDeveloperKey(config.key).setAppId(config.projectNumber).setOrigin(window.location.origin).setTitle(title).setLocale(locale).enableFeature(api.Feature.SUPPORT_DRIVES).enableFeature(api.Feature.MULTISELECT_ENABLED).addView(view).addView(sharedView).setCallback((result) => {
      if (result.action === 'picked' || result.action === 'cancel') { resolve(result.action === 'picked' ? (result.docs ?? []).map((d) => ({ id: d.id, name: d.name })) : []); picker.dispose(); }
    }).build(); picker.setVisible(true);
  });
}
