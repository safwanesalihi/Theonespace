// The landing's editable information (lib/site-content.ts, Plateforme → Site), read on the server and
// handed to the page as plain data: what is switched off is left out, and a text the owner left as it was
// is null, so the page prints its own wording in the visitor's language. Server only: the page's bundle
// takes the type alone, never zod or the database.
import { defaultSiteContent, type SiteContent } from "@/lib/site-content";
import { siteContent } from "@/lib/site-content-server";

export type LandingContent = {
  announcement: { text: string; link: string; linkLabel: string } | null;
  pilot: { title: string | null; text: string | null; seatsLeft: number; deadline: string } | null;
  prices: { starter: number; pro: number; agency: number; note: string | null } | null;
  contact: { email: string; whatsapp: string; city: string | null; hours: string };
  social: { instagram: string; linkedin: string };
};

const own = (value: string, untouched: string) => (value === untouched ? null : value);

export function forLanding(c: SiteContent): LandingContent {
  const d = defaultSiteContent;
  return {
    announcement: c.announcement.on && c.announcement.text ? { text: c.announcement.text, link: c.announcement.link, linkLabel: c.announcement.linkLabel } : null,
    pilot: c.pilot.on ? { title: own(c.pilot.title, d.pilot.title), text: own(c.pilot.text, d.pilot.text), seatsLeft: c.pilot.seatsLeft, deadline: c.pilot.deadline } : null,
    prices: c.prices.show ? { starter: c.prices.starter, pro: c.prices.pro, agency: c.prices.agency, note: own(c.prices.note, d.prices.note) } : null,
    contact: { email: c.contact.email, whatsapp: c.contact.whatsapp, city: own(c.contact.city, d.contact.city), hours: c.contact.hours },
    social: c.social,
  };
}

/** The content as saved, or the defaults when the database can't answer in time (a build without one, an
 *  outage): the page always renders. */
export async function landingContent(): Promise<LandingContent> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<SiteContent>((resolve) => { timer = setTimeout(() => resolve(defaultSiteContent), 4000); });
  const content = await Promise.race([siteContent().then((s) => s.content), late]).catch(() => defaultSiteContent);
  clearTimeout(timer);
  return forLanding(content);
}
