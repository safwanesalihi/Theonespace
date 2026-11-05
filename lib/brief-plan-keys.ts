// The brand brief's sections and the content plan's formats, on their own: lib/process.ts names them without
// loading either module, because the public page reads lib/process.ts and must stay light.
export type BriefSection = 'overview' | 'identity' | 'goals' | 'audience' | 'requirements' | 'references';
export const briefSections: BriefSection[] = ['overview', 'identity', 'goals', 'audience', 'requirements', 'references'];

export type ItemType = 'reel' | 'post' | 'story';
export const itemTypes: ItemType[] = ['reel', 'post', 'story'];
