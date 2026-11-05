"use client";
// What a network will show for a post, in that network's own layout: the feed's card for a post, the full
// screen for a Reel, a Short, a TikTok or a story. Media keep their own proportions, so nothing is cut that
// the network wouldn't cut. Used by the composer and by the client's approval in the portal.
import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Bookmark, Earth, Heart, MessageCircle, MessageSquare, MoreHorizontal, Send, Share2, ThumbsDown, ThumbsUp, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import type { Network, SocialMedia, SocialTarget } from "@/lib/social";

type Props = { target: SocialTarget; media: SocialMedia[]; caption: string; account: string; picture?: string };

const rails: Record<Network, LucideIcon[]> = {
  instagram: [Heart, MessageCircle, Send, MoreHorizontal],
  facebook: [ThumbsUp, MessageCircle, Share2],
  tiktok: [Heart, MessageCircle, Bookmark, Share2],
  youtube: [ThumbsUp, ThumbsDown, MessageSquare, Share2],
};
const screenTitles: Partial<Record<Network, string>> = { instagram: "Reels", facebook: "Reels", youtube: "Shorts" };
// What the feed accepts, as width / height: within this a media is shown whole.
const feedRatio = { min: 0.8, max: 1.91 };
const captionFits = 60;

const isFullScreen = (target: SocialTarget) => target.format === "story" || target.format === "reel" || target.format === "short" || target.network === "tiktok";

/** Hashtags and mentions in the network's link colour. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/((?:^|(?<=\s))[#@][^\s#@]+)/g).map((part, i) => (/^[#@]/.test(part) ? <span key={i} className="post-preview-tag">{part}</span> : part))}</>;
}

function Avatar({ account, picture }: { account: string; picture?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="post-preview-avatar">
      {picture && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- the connected account's picture, on the network's own host
        <img src={picture} alt="" onError={() => setFailed(true)} />
      ) : account.slice(0, 1)}
    </span>
  );
}

/** One media as it is. A video on a full screen plays with a tap: the network's own overlay sits where the controls would. */
function Media({ item, full, onSize }: { item: SocialMedia; full: boolean; onSize: (url: string, ratio: number) => void }) {
  const [playing, setPlaying] = useState(false);
  if (item.source === "drive") {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- Drive's own preview of the file */}
        <img src={item.thumb} alt="" onLoad={(e) => onSize(item.url, e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
        {item.type === "video" && <span className="post-preview-play" aria-hidden="true">▶</span>}
      </>
    );
  }
  if (item.type === "video") {
    return (
      <>
        <video
          src={item.url}
          muted
          playsInline
          loop={full}
          controls={!full}
          preload="metadata"
          onLoadedMetadata={(e) => onSize(item.url, e.currentTarget.videoWidth / e.currentTarget.videoHeight)}
          onClick={full ? (e) => void (e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause()) : undefined}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        {full && !playing && <span className="post-preview-play" aria-hidden="true">▶</span>}
      </>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a user upload on the storage origin, shown as is
    <img src={item.url} alt="" onLoad={(e) => onSize(item.url, e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
  );
}

function Stepper({ count, index, onStep }: { count: number; index: number; onStep: (index: number) => void }) {
  const { t } = useI18n();
  if (count < 2) return null;
  return (
    <>
      <button type="button" className="post-preview-nav prev" disabled={index === 0} onClick={() => onStep(index - 1)} aria-label={t("Précédent")}><ArrowLeft size={14} /></button>
      <button type="button" className="post-preview-nav next" disabled={index >= count - 1} onClick={() => onStep(index + 1)} aria-label={t("Suivant")}><ArrowRight size={14} /></button>
    </>
  );
}

function FullScreen({ target, media, caption, account, picture }: Props) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [more, setMore] = useState(false);
  const story = target.format === "story";
  const items = story || target.format === "photos" ? media : media.slice(0, 1);
  const shown = Math.min(index, Math.max(0, items.length - 1));
  const current = items[shown];
  const title = target.network === "youtube" ? target.title?.trim() : "";
  const long = caption.length > captionFits || caption.includes("\n");
  return (
    <div className={`post-preview tall network-${target.network}${story ? " story" : ""}`}>
      <div className="post-preview-media">
        {current ? <Media key={current.url} item={current} full onSize={() => {}} /> : <span className="post-preview-empty">{t("Aucun média")}</span>}
        <Stepper count={items.length} index={shown} onStep={setIndex} />
      </div>
      {story ? (
        <div className="post-preview-screen-top">
          {items.length > 1 && <span className="post-preview-segments">{items.map((m, i) => <i key={m.url} className={i <= shown ? "on" : ""} />)}</span>}
          <span className="post-preview-screen-who"><Avatar account={account} picture={picture} /><strong>{account}</strong></span>
        </div>
      ) : (
        <>
          {screenTitles[target.network] && <span className="post-preview-screen-title">{screenTitles[target.network]}</span>}
          <div className="post-preview-rail" aria-hidden="true">{rails[target.network].map((Icon, i) => <Icon key={i} size={22} />)}</div>
          <div className={`post-preview-overlay${more ? " open" : ""}`}>
            <span className="post-preview-screen-who">
              <Avatar account={account} picture={picture} />
              <strong>{account}</strong>
              <span className="post-preview-follow">{t(target.network === "youtube" ? "S’abonner" : "Suivre")}</span>
            </span>
            {title && <p className="post-preview-screen-title-text">{title}</p>}
            {caption && <p className="post-preview-text"><Rich text={caption} /></p>}
            {caption && long && <button type="button" className="post-preview-more" aria-expanded={more} onClick={() => setMore((open) => !open)}>{t(more ? "moins" : "plus")}</button>}
          </div>
        </>
      )}
    </div>
  );
}

/** The first media sets the frame, as in a carousel; within what the feed accepts, it is shown whole. */
function FeedMedia({ items, network, onOutside, children }: { items: SocialMedia[]; network: Network; onOutside: (outside: boolean) => void; children?: ReactNode }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const shown = Math.min(index, Math.max(0, items.length - 1));
  const current = items[shown];
  const measured = items[0] ? ratios[items[0].url] : undefined;
  const ratio = network === "youtube" ? 16 / 9 : measured ? Math.min(feedRatio.max, Math.max(feedRatio.min, measured)) : 1;
  const onSize = (url: string, value: number) => {
    if (!Number.isFinite(value) || !value) return;
    setRatios((known) => (known[url] === value ? known : { ...known, [url]: value }));
    if (url === items[0]?.url) onOutside(value < feedRatio.min - 0.01 || value > feedRatio.max + 0.01);
  };
  return (
    <div className="post-preview-media" style={{ aspectRatio: ratio }}>
      {current ? <Media key={current.url} item={current} full={false} onSize={onSize} /> : <span className="post-preview-empty">{t("Aucun média")}</span>}
      <Stepper count={items.length} index={shown} onStep={setIndex} />
      {items.length > 1 && (
        <>
          <span className="post-preview-count">{shown + 1}/{items.length}</span>
          <span className="post-preview-dots">{items.map((m, i) => <i key={m.url} className={i === shown ? "on" : ""} />)}</span>
        </>
      )}
      {children}
    </div>
  );
}

/** Facebook lays several photos out together instead of swiping through them. */
function Collage({ items }: { items: SocialMedia[] }) {
  const tiles = items.slice(0, 4);
  return (
    <div className={`post-preview-collage count-${tiles.length}`}>
      {tiles.map((item, i) => (
        <span key={item.url}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a user upload or Drive's preview, shown as is */}
          <img src={item.source === "drive" ? item.thumb : item.url} alt="" />
          {i === 3 && items.length > 4 && <b>+{items.length - 4}</b>}
        </span>
      ))}
    </div>
  );
}

function Feed({ target, media, caption, account, picture }: Props) {
  const { t } = useI18n();
  const [outside, setOutside] = useState(false);
  const { network } = target;
  if (network === "facebook") {
    return (
      <div className="post-preview network-facebook">
        <div className="post-preview-head">
          <Avatar account={account} picture={picture} />
          <span className="post-preview-who"><strong>{account}</strong><small>{t("À l’instant")} · <Earth size={11} aria-hidden="true" /></small></span>
          <MoreHorizontal size={18} className="post-preview-menu" aria-hidden="true" />
        </div>
        {caption && <p className="post-preview-text top"><Rich text={caption} /></p>}
        {media.length > 1 ? <Collage items={media} /> : media.length === 1 ? <FeedMedia items={media} network={network} onOutside={() => {}} /> : null}
        <div className="post-preview-actions" aria-hidden="true">
          <span><ThumbsUp size={16} />{t("J’aime")}</span>
          <span><MessageSquare size={16} />{t("Commenter")}</span>
          <span><Share2 size={16} />{t("Partager")}</span>
        </div>
      </div>
    );
  }
  if (network === "youtube") {
    return (
      <div className="post-preview network-youtube">
        <FeedMedia items={media.slice(0, 1)} network={network} onOutside={() => {}} />
        <p className="post-preview-title">{target.title?.trim() || t("Titre de la vidéo")}</p>
        <div className="post-preview-head">
          <Avatar account={account} picture={picture} />
          <span className="post-preview-who"><strong>{account}</strong></span>
          <span className="post-preview-follow">{t("S’abonner")}</span>
        </div>
        {caption && <p className="post-preview-text"><Rich text={caption} /></p>}
      </div>
    );
  }
  const items = target.format === "carousel" ? media : media.slice(0, 1);
  return (
    <div className="post-preview network-instagram">
      <div className="post-preview-head">
        <Avatar account={account} picture={picture} />
        <span className="post-preview-who"><strong>{account}</strong></span>
        <MoreHorizontal size={18} className="post-preview-menu" aria-hidden="true" />
      </div>
      <FeedMedia items={items} network={network} onOutside={setOutside} />
      <div className="post-preview-actions" aria-hidden="true">
        <span className="ig-actions-main"><Heart size={22} /><MessageCircle size={22} style={{ transform: "scaleX(-1)" }} /><Send size={22} /></span>
        <Bookmark size={22} />
      </div>
      {caption && <p className="post-preview-text"><strong>{account}</strong> <Rich text={caption} /></p>}
      {outside && <p className="post-preview-note">{t("Instagram accepte de 4:5 à 1,91:1 : recadrez ce média avant de publier.")}</p>}
    </div>
  );
}

/** What the network will show: its frame, the media and the text in its own layout. */
export default function PostPreview(props: Props) {
  const { t } = useI18n();
  const key = `${props.target.network}:${props.target.format}`;
  if (!isFullScreen(props.target)) return <Feed key={key} {...props} />;
  return (
    <>
      <FullScreen key={key} {...props} />
      {props.target.format === "story" && props.caption && <p className="post-preview-note">{t("Une story n’affiche pas le texte.")}</p>}
    </>
  );
}
