// Ready-made processes a studio starts from (picked at sign-up, or again on « Personnaliser »). Each is
// only a starting point: the owner renames, adds, reorders and removes statuses and pages afterwards.
// Labels are French source strings, so they read in the studio's language until the owner renames them.
import { defaultGroups, oneCoreProcess, withPages, type Process, type StatusDef } from '@/lib/process';

export type Preset = { id: string; label: string; description: string; process: Process };

const paused: StatusDef = { id: 'paused', label: 'En pause', color: 'slate', behaviour: 'paused' };
const internal: StatusDef = { id: 'internal', label: 'Validation interne', color: 'purple', behaviour: 'internal' };

export const presets: Preset[] = [
  {
    id: 'one-core',
    label: 'Studio de contenu',
    description: 'À faire, en cours, en pause, validation interne, validation client, validé : le processus de The One Core.',
    process: oneCoreProcess,
  },
  {
    id: 'social',
    label: 'Agence social media',
    description: 'De l’idée à la publication : rédaction, design, validation interne et client, publié.',
    process: {
      preset: 'social',
      statuses: [
        { id: 'idea', label: 'Idée', color: 'gray', behaviour: 'todo' },
        { id: 'copy', label: 'Rédaction', color: 'blue', behaviour: 'work' },
        { id: 'design', label: 'Design', color: 'indigo', behaviour: 'work' },
        paused,
        internal,
        { id: 'client', label: 'Chez le client', color: 'orange', behaviour: 'client' },
        { id: 'approved', label: 'Validé', color: 'green', behaviour: 'done' },
        { id: 'published', label: 'Publié', color: 'teal', behaviour: 'done' },
      ],
      pages: withPages(),
      groups: defaultGroups(),
    },
  },
  {
    id: 'video',
    label: 'Production vidéo',
    description: 'Brief, pré-production, tournage, montage, étalonnage, puis validation et livraison.',
    process: {
      preset: 'video',
      statuses: [
        { id: 'brief', label: 'Brief', color: 'gray', behaviour: 'todo' },
        { id: 'preprod', label: 'Pré-production', color: 'blue', behaviour: 'work' },
        { id: 'shoot', label: 'Tournage', color: 'indigo', behaviour: 'work' },
        { id: 'edit', label: 'Montage', color: 'teal', behaviour: 'work' },
        { id: 'grade', label: 'Étalonnage et son', color: 'amber', behaviour: 'work' },
        paused,
        internal,
        { id: 'client', label: 'Chez le client', color: 'orange', behaviour: 'client' },
        { id: 'delivered', label: 'Livré', color: 'green', behaviour: 'done' },
      ],
      pages: withPages({ social: { on: false }, ig: { on: false }, 'ig-search': { on: false } }),
      groups: defaultGroups(),
    },
  },
  {
    id: 'branding',
    label: 'Branding et design',
    description: 'Brief, recherche, pistes créatives, présentation au client, finalisation.',
    process: {
      preset: 'branding',
      statuses: [
        { id: 'brief', label: 'Brief', color: 'gray', behaviour: 'todo' },
        { id: 'research', label: 'Recherche', color: 'blue', behaviour: 'work' },
        { id: 'concepts', label: 'Pistes créatives', color: 'indigo', behaviour: 'work' },
        { id: 'final', label: 'Finalisation', color: 'teal', behaviour: 'work' },
        paused,
        internal,
        { id: 'client', label: 'Présentation client', color: 'orange', behaviour: 'client' },
        { id: 'delivered', label: 'Livré', color: 'green', behaviour: 'done' },
      ],
      pages: withPages({ shoots: { on: false }, social: { on: false }, ig: { on: false }, 'ig-search': { on: false } }),
      groups: defaultGroups(),
    },
  },
];

export const presetIds = presets.map((p) => p.id);
export const isPresetId = (value: unknown): value is string => typeof value === 'string' && presetIds.includes(value);
/** A preset's process, as a fresh copy the studio can change. */
export const presetProcess = (id: string): Process => structuredClone((presets.find((p) => p.id === id) ?? presets[0]).process);
