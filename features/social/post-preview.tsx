"use client";
// What a network will show for a post, roughly: its frame, the media (swipe through a carousel) and
// the text in that network's layout. Used by the composer and by the client's approval in the portal.
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Heart, MessageCircle, Send, Bookmark, ThumbsUp, MessageSquare, Share2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/locale-provider";
import { formatLabels, type SocialMedia, type SocialTarget } from "@/lib/social";

/** What the network will show, roughly: frame, media and text in its own layout. */
export default function PostPreview({ target, media, caption, account }: { target: SocialTarget; media: SocialMedia[]; caption: string; account: string }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const tall = target.format === "story" || target.format === "reel" || target.format === "short" || target.network === "tiktok";
  const items = useMemo(() => (target.format === "carousel" || target.format === "photos" || target.network === "facebook" ? media : media.slice(0, 1)), [media, target]);
  const current = items[Math.min(index, Math.max(0, items.length - 1))];
  const showCaption = target.format !== "story";
  return (
    <div className={`post-preview network-${target.network} ${tall ? "tall" : ""}`}>
      <div className="post-preview-head">
        <span className="post-preview-avatar">{account.slice(0, 1)}</span>
        <strong>{account}</strong>
        <small>{t(formatLabels[target.format])}</small>
      </div>
      {target.network === "facebook" && showCaption && caption && <p className="post-preview-text top">{caption}</p>}
      <div className="post-preview-media">
        {current ? (
          current.source === "drive" ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- Drive's own preview of the file */}
              <img key={current.url} src={current.thumb} alt="" />
              {current.type === "video" && <span className="post-preview-play" aria-hidden="true">▶</span>}
            </>
          ) : current.type === "video" ? <video key={current.url} src={current.url} muted controls preload="metadata" /> : (
            // eslint-disable-next-line @next/next/no-img-element -- a user upload on the storage origin, shown as is
            <img key={current.url} src={current.url} alt="" />
          )
        ) : (
          <span className="post-preview-empty">{t("Aucun média")}</span>
        )}
        {items.length > 1 && (
          <>
            <button type="button" className="post-preview-nav prev" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))} aria-label={t("Précédent")}><ArrowLeft size={14} /></button>
            <button type="button" className="post-preview-nav next" disabled={index >= items.length - 1} onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))} aria-label={t("Suivant")}><ArrowRight size={14} /></button>
            <span className="post-preview-dots">{items.map((m, i) => <i key={m.url} className={i === index ? "on" : ""} />)}</span>
          </>
        )}
      </div>
      {target.network === "youtube" && <p className="post-preview-title">{target.title || t("Titre de la vidéo")}</p>}
      
      <div className="post-preview-actions">
        {target.network === 'facebook' ? (
          <>
            <button type="button"><ThumbsUp size={16} />{t("J’aime")}</button>
            <button type="button"><MessageSquare size={16} /> Commenter</button>
            <button type="button"><Share2 size={16} /> Partager</button>
          </>
        ) : target.network === 'instagram' ? (
          <>
            <div className="ig-actions-main">
              <button type="button"><Heart size={20} /></button>
              <button type="button"><MessageCircle size={20} style={{transform: 'scaleX(-1)'}} /></button>
              <button type="button"><Send size={20} /></button>
            </div>
            <button type="button"><Bookmark size={20} /></button>
          </>
        ) : null}
      </div>
      {target.network !== "facebook" && showCaption && caption && <p className="post-preview-text"><strong>{account}</strong> {caption}</p>}
    </div>
  );
}
