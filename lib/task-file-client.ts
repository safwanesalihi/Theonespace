import type { Attachment } from '@/lib/model';
import { maxTaskFileBytes, smallTaskFileBytes, taskFileChunkBytes, taskFileType } from '@/lib/task-files';

const interrupted = () => new DOMException('Upload cancelled', 'AbortError');
const connectionError = 'Connexion au serveur impossible. Vérifiez votre connexion internet, puis réessayez : votre texte est conservé.';

function transfer(url: string, method: string, body: Blob | FormData, workspaceId: string, signal: AbortSignal, progress: (bytes: number) => void): Promise<{ id?: string; type?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(interrupted()); return; }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener('abort', abort);
    xhr.open(method, url); xhr.timeout = 120_000;
    xhr.setRequestHeader('X-Workspace-Id', workspaceId);
    if (body instanceof Blob) xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = e => progress(e.loaded);
    xhr.onload = () => {
      finish(); let data: { id?: string; type?: string; error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* A proxy error can return HTML. */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(Object.assign(new Error(data.error || 'Envoi impossible.'), { retryable: xhr.status >= 500 }));
    };
    xhr.onerror = xhr.ontimeout = () => { finish(); reject(Object.assign(new Error(connectionError), { retryable: true })); };
    xhr.onabort = () => { finish(); reject(interrupted()); };
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}

export async function uploadTaskFile(file: File, workspaceId: string, signal: AbortSignal, progress: (percent: number) => void): Promise<Attachment> {
  if (!file.size || file.size > maxTaskFileBytes) throw new Error('Fichier vide ou trop lourd (100 Mo maximum).');
  const type = taskFileType(file.type, file.name);
  const jsonHeaders = { 'X-Workspace-Id': workspaceId, 'Content-Type': 'application/json' };
  let uploadId: string | undefined;
  const read = async (response: Response) => {
    const data = await response.json().catch(() => ({})) as { id?: string; type?: string; error?: string };
    if (!response.ok) throw new Error(data.error || 'Envoi impossible.');
    return data;
  };
  try {
    if (file.size <= smallTaskFileBytes) {
      const body = new FormData(); body.append('kind', 'file'); body.append('file', file);
      const data = await transfer('/api/assets', 'POST', body, workspaceId, signal, n => progress(Math.min(99, Math.round(n / file.size * 100))));
      if (!data.id) throw new Error('Envoi impossible.');
      progress(100); return { id: data.id, name: file.name, type: data.type || type, size: file.size };
    }
    const init = await read(await fetch('/api/assets/uploads', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name: file.name, type, size: file.size }), signal }));
    if (!init.id) throw new Error('Envoi impossible.');
    uploadId = init.id;
    for (let offset = 0, part = 0; offset < file.size; offset += taskFileChunkBytes, part++) {
      const body = file.slice(offset, offset + taskFileChunkBytes);
      for (let attempt = 0; ; attempt++) {
        try {
          await transfer(`/api/assets/uploads/${uploadId}?part=${part}`, 'PUT', body, workspaceId, signal, n => progress(Math.min(99, Math.round((offset + n) / file.size * 100))));
          break;
        } catch (error) {
          if (signal.aborted || attempt >= 2 || !(error as { retryable?: boolean }).retryable) throw error;
        }
      }
    }
    const data = await read(await fetch(`/api/assets/uploads/${uploadId}`, { method: 'POST', headers: jsonHeaders, signal }));
    if (!data.id) throw new Error('Envoi impossible.');
    progress(100); return { id: data.id, name: file.name, type: data.type || type, size: file.size };
  } catch (error) {
    if (uploadId) void fetch(`/api/assets/uploads/${uploadId}`, { method: 'DELETE', headers: jsonHeaders, keepalive: true }).catch(() => {});
    if (signal.aborted) throw interrupted();
    if (error instanceof TypeError) throw new Error(connectionError);
    throw error;
  }
}
