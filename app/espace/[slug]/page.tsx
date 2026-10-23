import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PlanetPage from "@/features/landing/planet-page";
import { planets, type PlanetSlug } from "@/features/landing/planets";

// The six topics of the public page, each at its own address (features/landing/planets.ts).
export const dynamicParams = false;
export function generateStaticParams() {
  return planets.map(({ slug }) => ({ slug }));
}

const find = (slug: string) => planets.find((p) => p.slug === slug);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const planet = find((await params).slug);
  if (!planet) return {};
  return { title: `${planet.title} — The One Space`, description: planet.tagline, alternates: { canonical: `/espace/${planet.slug}` } };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const planet = find((await params).slug);
  if (!planet) notFound();
  return <PlanetPage slug={planet.slug as PlanetSlug} />;
}
