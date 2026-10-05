// Shared by the chat picker and upload routes. Preserve originals, including design source files.
export const maxTaskFileBytes = 100_000_000;
export const smallTaskFileBytes = 4_000_000;
export const taskFileChunkBytes = 3_000_000;

const types: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', svg: 'image/svg+xml',
  tif: 'image/tiff', tiff: 'image/tiff', psd: 'image/vnd.adobe.photoshop',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac',
  ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', aif: 'audio/aiff', aiff: 'audio/aiff',
  pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', html: 'text/html',
  ai: 'application/postscript', eps: 'application/postscript',
};
export function taskFileType(type: string, name: string) {
  const bare = type.split(';')[0].trim().toLowerCase();
  const inferred = types[name.split('.').pop()?.toLowerCase() ?? ''];
  if (!bare || bare === 'application/octet-stream') return inferred || 'application/octet-stream';
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(bare) ? bare : 'application/octet-stream';
}
export const previewImage = (type: string) => ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'].includes(type);
// Active documents (HTML, SVG, XML…) must download, never execute on the app's authenticated origin.
export const inlineTaskFile = (type: string) => previewImage(type) || type.startsWith('video/') || type.startsWith('audio/') || type === 'application/pdf';
export function taskFileLabel(name: string, type: string) {
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return ext && /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toUpperCase() : type.split('/')[1]?.toUpperCase().slice(0, 8) || 'FILE';
}
