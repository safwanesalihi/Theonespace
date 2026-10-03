// Reproduce Google's shared-drive-only view filtering at the SDK boundary.
// A personal folder must remain available even when shared drive support is enabled.
import { strict as assert } from 'node:assert';
import { globSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const esbuild = await import(pathToFileURL(globSync('node_modules/.pnpm/esbuild@*/node_modules/esbuild/lib/main.js')[0]));
mkdirSync('.sites-runtime', { recursive: true });
await esbuild.build({ entryPoints: ['app/drive-client.ts'], outfile: '.sites-runtime/drive-picker-test.mjs', bundle: true, platform: 'node', format: 'esm' });
const { chooseDriveRoot, chooseDriveFiles } = await import(pathToFileURL(`${process.cwd()}/.sites-runtime/drive-picker-test.mjs`));
const realFetch = globalThis.fetch, realWindow = globalThis.window;
let selection, disposed = false, checks = 0;
class DocsView {
  constructor(kind) { this.kind = kind; this.sharedOnly = false; }
  setIncludeFolders(v) { this.includeFolders = v; return this; }
  setSelectFolderEnabled(v) { this.selectFolder = v; return this; }
  setEnableDrives(v) { this.sharedOnly = v; return this; }
  setMimeTypes(v) { this.mimeTypes = v; return this; }
}
class PickerBuilder {
  views = []; features = [];
  setOAuthToken() { return this; } setDeveloperKey() { return this; }
  setAppId() { return this; } setOrigin() { return this; }
  setTitle() { return this; } setLocale() { return this; }
  addView(v) { this.views.push(v); return this; }
  enableFeature(v) { this.features.push(v); return this; }
  setCallback(v) { this.callback = v; return this; }
  build() {
    const eligible = selection && this.views.some(v => v.sharedOnly === selection.shared &&
      (selection.folder ? v.selectFolder && v.mimeTypes === 'application/vnd.google-apps.folder' : v.kind === 'docs' && !v.selectFolder));
    if (eligible && !selection.folder) assert.ok(this.features.includes('multi'), 'file import allows multiple files');
    return { dispose() { disposed = true; }, setVisible: () => this.callback(eligible ? { action: 'picked', docs: selection.docs } : { action: 'cancel' }) };
  }
}
try {
  globalThis.window = { location: { origin: 'https://space.test' }, google: { picker: { DocsView, PickerBuilder, ViewId: { FOLDERS: 'folders', DOCS: 'docs' }, Feature: { SUPPORT_DRIVES: 'shared', MULTISELECT_ENABLED: 'multi' } } } };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/drive/connection'); assert.equal(init.headers['X-Workspace-Id'], 'agency');
    assert.deepEqual(JSON.parse(init.body), { action: 'picker' });
    return new Response(JSON.stringify({ accessToken: 'short-lived', key: 'restricted-key', projectNumber: '123456' }));
  };
  for (const shared of [false, true]) {
    disposed = false; selection = { shared, folder: true, docs: [{ id: 'agency-folder', name: 'THE ONE CORE' }] };
    assert.equal(await chooseDriveRoot('agency', 'en', 'Choose agency folder'), 'agency-folder', `${shared ? 'shared' : 'personal'} agency folder is available`); checks++;
    assert.ok(disposed, 'folder picker closes after selection'); checks++;
    disposed = false; selection = { shared, folder: false, docs: [{ id: 'photo', name: 'Photo.jpg' }, { id: 'video', name: 'Video.mp4' }] };
    assert.deepEqual(await chooseDriveFiles('agency', 'en', 'Choose files'), selection.docs, `${shared ? 'shared' : 'personal'} files are available`); checks++;
    assert.ok(disposed, 'file picker closes after selection'); checks++;
  }
  disposed = false; selection = null;
  assert.equal(await chooseDriveRoot('agency', 'en', 'Choose agency folder'), null); checks++;
  assert.ok(disposed, 'cancelled picker closes'); checks++;
  console.log(`Google Picker checks passed: ${checks} (personal/shared folders and files, multi-selection, cancellation).`);
} finally { globalThis.fetch = realFetch; globalThis.window = realWindow; }
