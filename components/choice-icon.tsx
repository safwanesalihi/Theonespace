// The drawings of the icons an agency may choose (lib/icon-choices.ts), and the app's own icon for each thing
// that can take one. A stored id that no longer exists simply falls back to the app's own.
import { createElement } from "react";
import {
  Activity, Aperture, AtSign, BarChart3, Bell, Bookmark, BookOpen, Brush, Briefcase, Building2, CalendarClock, CalendarDays, CalendarRange, Camera,
  ChartColumn, ChartLine, ChartNoAxesCombined, CheckCircle2, CheckSquare, Circle, Clapperboard, ClipboardList, Clock, Coins, Compass, Crown, Eye, Feather,
  FileSignature, FileText, Film, Flag, Flame, Folder, Gauge, Gem, Globe, Handshake, Hash, Heart, Image, Images, Inbox, Key, Layers, Library, Lightbulb, Link2, List, ListChecks,
  Mail, Map, Medal, Megaphone, MessageCircle, MessagesSquare, Mic, Music, Palette, Paperclip, PenTool, Phone, Puzzle, Rocket, Scale, Search, Send, Settings, Shapes, Share2,
  Shield, ShieldCheck, ShoppingBag, Smartphone, Smile, Sparkles, Star, Store, Tag, Target, ThumbsUp, TrendingUp, Trophy, Type, User, Users, Video, WandSparkles, Zap,
  type LucideIcon, type LucideProps,
} from "lucide-react";
import type { BriefSection } from "@/lib/client-brief";
import type { ItemType } from "@/lib/content-plan";
import type { IconId } from "@/lib/icon-choices";
import type { PageId, PortalSection } from "@/lib/process";

const icons: Record<IconId, LucideIcon> = {
  sparkles: Sparkles, palette: Palette, "pen-tool": PenTool, brush: Brush, wand: WandSparkles, shapes: Shapes, layers: Layers, type: Type, feather: Feather, image: Image, images: Images,
  camera: Camera, aperture: Aperture, clapperboard: Clapperboard, video: Video, film: Film, mic: Mic, music: Music, circle: Circle, star: Star, heart: Heart, flame: Flame, gem: Gem, crown: Crown,
  target: Target, flag: Flag, compass: Compass, map: Map, rocket: Rocket, lightbulb: Lightbulb, puzzle: Puzzle, trophy: Trophy, medal: Medal, "trending-up": TrendingUp, "chart-column": ChartColumn,
  "chart-line": ChartLine, gauge: Gauge, activity: Activity, zap: Zap, eye: Eye, key: Key, shield: Shield, scale: Scale, coins: Coins,
  users: Users, user: User, handshake: Handshake, megaphone: Megaphone, "message-circle": MessageCircle, messages: MessagesSquare, mail: Mail, phone: Phone, smartphone: Smartphone, globe: Globe,
  share: Share2, hash: Hash, "at-sign": AtSign, "thumbs-up": ThumbsUp, smile: Smile, bell: Bell,
  "check-square": CheckSquare, "check-circle": CheckCircle2, list: List, "list-checks": ListChecks, clipboard: ClipboardList, calendar: CalendarDays, "calendar-range": CalendarRange,
  "calendar-clock": CalendarClock, clock: Clock, inbox: Inbox, send: Send, folder: Folder, "file-text": FileText, "file-signature": FileSignature, "book-open": BookOpen, library: Library,
  link: Link2, paperclip: Paperclip, bookmark: Bookmark, tag: Tag, briefcase: Briefcase, building: Building2, store: Store, "shopping-bag": ShoppingBag, search: Search, settings: Settings,
};

/** The drawing of a chosen icon; undefined when none is chosen, or the id is unknown. */
export const iconOf = (id: string | undefined): LucideIcon | undefined =>
  (id && Object.prototype.hasOwnProperty.call(icons, id) ? icons[id as IconId] : undefined);

/** The chosen icon, or the app's own. */
export const ChoiceIcon = ({ id, fallback, ...props }: { id?: string; fallback: LucideIcon } & LucideProps) =>
  createElement(iconOf(id) ?? fallback, props);

export const briefIcons: Record<BriefSection, LucideIcon> = { overview: Sparkles, identity: Palette, goals: Target, audience: Users, requirements: Flag, references: Link2 };
export const planTypeIcons: Record<ItemType, LucideIcon> = { reel: Clapperboard, post: Image, story: Circle };
export const pageIcons: Record<PageId, LucideIcon> = {
  tasks: CheckSquare, internal: ShieldCheck, shoots: Camera, requests: Inbox, social: Megaphone, ig: ChartNoAxesCombined, "ig-search": Search, library: Library,
  crm: Handshake, meetings: CalendarClock, team: Users, activity: Activity,
};
export const portalIcons: Record<PortalSection, LucideIcon> = {
  tasks: List, calendar: CalendarDays, plan: CalendarRange, files: FileText, documents: FileSignature, request: Inbox, meetings: CalendarClock, stats: BarChart3, accounts: Link2,
};
