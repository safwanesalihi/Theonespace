// The Social hub's rules, shared by the browser and the server: which networks and formats a post can
// target, what each format accepts, and the status a post is in. No database or network access here.
//
// A post (kind 'editorial_post') carries:
//   targets  — one entry per network: its format, and optionally its own caption (and a YouTube title)
//   media    — the photos and videos, in order (a carousel is several)
//   description — the caption used wherever a target has none of its own
//   socialState — 'draft' until the studio schedules it, then 'scheduled'
//   approval — the client's answer, when that client approves posts before they go out
import type { RecordItem } from '@/lib/model';

export const networks = ['instagram', 'facebook', 'tiktok', 'youtube'] as const;
export type Network = (typeof networks)[number];
export const networkLabels: Record<Network, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };

export const formats = ['post', 'carousel', 'reel', 'story', 'video', 'photos', 'short'] as const;
export type PostFormat = (typeof formats)[number];
export const formatLabels: Record<PostFormat, string> = {
  post: 'Post', carousel: 'Carrousel', reel: 'Reel', story: 'Story', video: 'Vidéo', photos: 'Photos', short: 'Short',
};
export const formatsFor: Record<Network, PostFormat[]> = {
  instagram: ['post', 'carousel', 'reel', 'story'],
  facebook: ['post'],
  tiktok: ['video', 'photos'],
  youtube: ['short', 'video'],
};
/** Networks the app publishes to itself today; the others are planned here and posted by hand. */
export const autoNetworks: Network[] = ['instagram', 'facebook'];

export type SocialTarget = { network: Network; format: PostFormat; caption?: string; title?: string };
/**
 * A photo or video: uploaded to the app's storage (`path` set), or a Google Drive file (`source:
 * 'drive'`, `url` its direct download address, `thumb` Drive's preview). `mime` is known for Drive
 * files, whose format is whatever was put in Drive.
 */
export type SocialMedia = { url: string; type: 'image' | 'video'; path?: string; source?: 'upload' | 'drive'; thumb?: string; mime?: string; name?: string };
export type PostApproval = { state: 'pending' | 'approved' | 'changes'; at: string; by?: string; note?: string };

export const captionLimits: Record<Network, number> = { instagram: 2200, facebook: 63206, tiktok: 2200, youtube: 5000 };
export const limits = { media: 10, titleLength: 100, hashtags: 30 };

const networkOfName = (name: string): Network | null => {
  const key = name.trim().toLowerCase();
  return (networks as readonly string[]).includes(key) ? (key as Network) : null;
};

/**
 * The post's targets. Posts made before the Social hub have none: they are read from their platform
 * ids (`channels`) and single format (`postType`), so old plans keep showing where they were meant to go.
 */
export function targetsOf(post: RecordItem, platforms: RecordItem[] = []): SocialTarget[] {
  if (post.targets?.length) return post.targets;
  const legacyFormat = (network: Network): PostFormat => {
    const type = (post.postType || '').toLowerCase();
    if (network === 'instagram') return type === 'story' ? 'story' : type === 'reel' ? 'reel' : type === 'carrousel' ? 'carousel' : 'post';
    if (network === 'tiktok') return 'video';
    if (network === 'youtube') return 'video';
    return 'post';
  };
  const seen = new Set<Network>();
  return (post.channels ?? []).flatMap((id) => {
    const network = networkOfName(platforms.find((p) => p.id === id)?.name || '');
    if (!network || seen.has(network)) return [];
    seen.add(network);
    return [{ network, format: legacyFormat(network) }];
  });
}

/** The post's photos and videos, including the single one of a pre-hub post. */
export function mediaOf(post: RecordItem): SocialMedia[] {
  if (post.media?.length) return post.media;
  return post.mediaUrl && post.mediaType ? [{ url: post.mediaUrl, type: post.mediaType, path: post.mediaPath }] : [];
}

export const captionFor = (post: RecordItem, target: SocialTarget) => (target.caption ?? '').trim() || post.description || '';

/** What stops this target from being published as it stands (empty: ready). */
export function problemsFor(post: RecordItem, target: SocialTarget): string[] {
  const media = mediaOf(post);
  const images = media.filter((m) => m.type === 'image').length, videos = media.length - images;
  const caption = captionFor(post, target);
  const out: string[] = [];
  const need = (ok: boolean, message: string) => { if (!ok) out.push(message); };
  switch (`${target.network}:${target.format}`) {
    case 'instagram:post': need(media.length === 1 && images === 1, 'Un post Instagram publie une seule photo.'); break;
    case 'instagram:carousel': need(media.length >= 2 && media.length <= 10, 'Un carrousel Instagram compte de 2 à 10 photos ou vidéos.'); break;
    case 'instagram:reel': need(media.length === 1 && videos === 1, 'Un Reel publie une seule vidéo.'); break;
    case 'instagram:story': need(media.length === 1, 'Une story publie une seule photo ou vidéo.'); break;
    case 'facebook:post':
      need(!!caption.trim() || media.length > 0, 'Ajoutez un texte ou un média.');
      need(videos === 0 || (videos === 1 && media.length === 1), 'Facebook : une vidéo seule, ou des photos (pas les deux).');
      break;
    case 'tiktok:video': need(media.length === 1 && videos === 1, 'TikTok : une seule vidéo.'); break;
    case 'tiktok:photos': need(images >= 1 && videos === 0 && images <= 35, 'TikTok Photos : de 1 à 35 photos, sans vidéo.'); break;
    case 'youtube:short':
    case 'youtube:video':
      need(media.length === 1 && videos === 1, 'YouTube : une seule vidéo.');
      need(!!target.title?.trim(), 'Donnez un titre à la vidéo YouTube.');
      break;
    default: out.push('Format non pris en charge sur ce réseau.');
  }
  if (target.network === 'instagram' && media.some((m) => m.type === 'image' && m.mime && m.mime !== 'image/jpeg')) {
    out.push('Instagram n’accepte que les photos JPEG : exportez l’image en .jpg dans Drive.');
  }
  if (caption.length > captionLimits[target.network]) out.push(`Texte trop long pour ${networkLabels[target.network]} (${captionLimits[target.network]} caractères au plus).`);
  if (target.network === 'instagram' && (caption.match(/#[^\s#]+/g) ?? []).length > limits.hashtags) out.push(`Instagram accepte ${limits.hashtags} hashtags au plus.`);
  if ((target.title?.length ?? 0) > limits.titleLength) out.push(`Titre YouTube : ${limits.titleLength} caractères au plus.`);
  return out;
}

export type PostStatus = 'draft' | 'awaiting' | 'changes' | 'scheduled' | 'publishing' | 'failed' | 'manual' | 'published';
export const statusLabels: Record<PostStatus, string> = {
  draft: 'Brouillon', awaiting: 'À valider (client)', changes: 'Modifications demandées', scheduled: 'Programmé',
  publishing: 'Publication…', failed: 'Échec', manual: 'À publier à la main', published: 'Publié',
};

/** Whether the client's approval is still needed before this post can go out. */
export const awaitingClient = (post: RecordItem, client?: RecordItem) => !!client?.postApproval && post.approval?.state !== 'approved';

/** `nowKey` ("YYYY-MM-DD HH:MM", studio time): lets a post whose time has come show what's left to do by hand. */
export function postStatus(post: RecordItem, client?: RecordItem, platforms: RecordItem[] = [], nowKey?: string): PostStatus {
  if (post.publishedAt) return 'published';
  const results = post.publishResults ?? {};
  const targets = targetsOf(post, platforms);
  if (post.publishingAt || Object.values(results).some((r) => r.pending)) return 'publishing';
  if (targets.some((t) => results[t.network] && !results[t.network].ok)) return 'failed';
  if (post.socialState !== 'scheduled') return 'draft';
  if (post.approval?.state === 'changes') return 'changes';
  if (awaitingClient(post, client)) return 'awaiting';
  const autoLeft = targets.some((t) => autoNetworks.includes(t.network) && !results[t.network]?.ok);
  const manualLeft = targets.some((t) => !autoNetworks.includes(t.network) && !results[t.network]?.ok);
  if (!autoLeft && manualLeft && nowKey && dueKey(post) <= nowKey) return 'manual';
  return 'scheduled';
}

/** When the post is due, as a comparable "YYYY-MM-DD HH:MM" in the studio's time zone. */
export const dueKey = (post: RecordItem) => `${post.due || ''} ${post.time || '09:00'}`;
