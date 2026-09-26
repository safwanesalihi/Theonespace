import { z } from 'zod';
import { statuses, channels, postTypes, libraryCategories, docTypes, docStatuses } from './model';
import { formats, formatsFor, limits, networks } from './social';

const httpUrl = (value: string) => {
  if (!/^https?:\/\//i.test(value)) return false;
  try { return !!new URL(value).hostname; } catch { return false; }
};
const url = z.string().max(2000).refine((v) => !v || httpUrl(v), 'Utilisez un lien http:// ou https://.');
const source = z.string().trim().max(2000).refine(
  (v) => !v || ['Réunion', 'WhatsApp', 'Contrat', 'Interne', 'Portail'].includes(v) || httpUrl(v),
  'Ajoutez un lien http:// ou https://, ou choisissez une source prédéfinie.',
);
const date = z.string().refine(
  (v) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v),
  'Date invalide.',
);

export const fields = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire.').max(160),
  clientId: z.string().max(100).optional(),
  projectId: z.string().max(100).optional(),
  assignee: z.string().trim().max(80).optional(),
  due: date.optional(),
  source: source.optional(),
  deliverable: url.optional(),
  description: z.string().max(15000).optional(),
  status: z.enum(statuses).optional(),
  archived: z.boolean().optional(),
  contact: z.string().max(150).optional(),
  email: z.union([z.literal(''), z.string().email()]).optional(),
  // Spaces, dots and dashes are dropped so "+212 6 12 34 56 78" is accepted as typed.
  whatsapp: z.string().trim().max(30)
    .transform((v) => v.replace(/[\s.()-]/g, ''))
    .refine((v) => !v || /^\+[1-9]\d{7,14}$/.test(v), 'Numéro WhatsApp au format international, ex. +212 6 12 34 56 78.')
    .optional(),
  city: z.string().max(100).optional(),
  sector: z.string().max(120).optional(),
  language: z.enum(['Français', 'العربية']).optional(),
  drive: url.optional(),
  contract: url.optional(),
  instagramId: z.string().trim().regex(/^$|^\d{5,30}$/, 'Identifiant Instagram invalide (chiffres uniquement).').optional(),
  facebookPageId: z.string().trim().regex(/^$|^\d{5,30}$/, 'Identifiant de page Facebook invalide (chiffres uniquement).').optional(),
  youtubeChannel: z.string().trim().max(60).optional(),
  channel: z.union([z.literal(''), z.enum(channels)]).optional(),
  time: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  // The One Flow
  quota: z.string().regex(/^$|^\d{1,3}$/, 'Indiquez un nombre de contenus par mois.').optional(),
  logo: z.string().regex(/^$|^[0-9a-f-]{36}$/).optional(),
  banner: z.string().regex(/^$|^[0-9a-f-]{36}$/).optional(),
  evergreen: z.boolean().optional(),
  publishable: z.boolean().optional(),
  postApproval: z.boolean().optional(),
});

export const requestFields = z.object({
  name: z.string().trim().min(1, 'Donnez un titre à votre demande.').max(160),
  projectId: z.string().max(100).optional(),
  description: z.string().max(15000).optional(),
  due: date.optional(),
  channel: z.union([z.literal(''), z.enum(channels)]).optional(),
});

export const libraryFields = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire.').max(160),
  category: z.enum(libraryCategories),
  content: z.string().trim().max(20000).optional(),
  link: url.optional(),
  description: z.string().max(2000).optional(),
}).refine((v) => v.category === 'prompt' ? !!v.content?.trim() : !!v.link?.trim(),
  { message: 'Un prompt a besoin d’un texte ; les autres catégories, d’un lien.', path: ['content'] });

export const documentFields = z.object({
  docType: z.enum(docTypes),
  clientId: z.string().max(100),
  name: z.string().trim().max(160).optional(),
  docStatus: z.enum(docStatuses).optional(),
  lineItems: z.array(z.object({
    description: z.string().trim().min(1).max(300),
    quantity: z.number().positive().max(100000),
    unitPrice: z.number().nonnegative().max(10000000),
  })).max(100).default([]),
  taxRate: z.number().min(0).max(100).optional(),
  issuedAt: date.optional(),
  dueAt: date.optional(),
  validUntil: date.optional(),
  notes: z.string().max(5000).optional(),
  archived: z.boolean().optional(),
});

export const platformFields = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire.').max(160),
});

export const editorialPostFields = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire.').max(160),
  clientId: z.string().max(100),
  due: date.refine((v) => !!v, 'La date de publication est obligatoire.'),
  channels: z.array(z.string().max(100)).max(20).optional(),
  postType: z.union([z.literal(''), z.enum(postTypes)]).optional(),
  description: z.string().max(15000).optional(),
  time: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:MM).').optional(),
  mediaUrl: url.optional(),
  mediaType: z.union([z.literal(''), z.enum(['image', 'video'])]).optional(),
  mediaPath: z.string().max(300).regex(/^$|^[\w-]+\/[\w-]+\.(jpg|mp4|mov)$/, 'Média invalide.').optional(),
  // Social hub (lib/social.ts)
  targets: z.array(z.object({
    network: z.enum(networks),
    format: z.enum(formats),
    caption: z.string().max(63206).optional(),
    title: z.string().max(limits.titleLength).optional(),
  }).refine((t) => formatsFor[t.network].includes(t.format), 'Format non pris en charge sur ce réseau.'))
    .max(networks.length)
    .refine((list) => new Set(list.map((t) => t.network)).size === list.length, 'Un seul format par réseau.')
    .optional(),
  media: z.array(z.object({
    url: url.refine((v) => !!v, 'Média invalide.'),
    type: z.enum(['image', 'video']),
    path: z.string().max(300).regex(/^[\w-]+\/[\w-]+\.(jpg|mp4|mov)$/, 'Média invalide.').optional(),
    source: z.enum(['upload', 'drive']).optional(),
    thumb: url.optional(),
    mime: z.string().max(100).regex(/^$|^[\w.+-]+\/[\w.+-]+$/).optional(),
    name: z.string().max(200).optional(),
  })).max(35).optional(),
  socialState: z.enum(['draft', 'scheduled']).optional(),
});

export const inviteFields = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(200),
  name: z.string().trim().max(120).optional(),
  role: z.enum(['admin', 'creative', 'social', 'print_operator', 'client']),
  clientId: z.string().max(100).optional(),
});
