// The six topics of the public page. Each opens as a window over the landing (features/landing/windows.tsx)
// and has its own address, /espace/<slug>, for shared links and search engines. French is the source text;
// every string goes through t() where it is shown. The points describe what the product does today
// (lib/flow.ts, lib/assistant-tools.ts, lib/plans.ts…), nothing more.
import { Gauge, Route, ShieldCheck, Smartphone, Sparkles, Send, type LucideIcon } from "lucide-react";

export type PlanetSlug = "methode" | "portail" | "publication" | "one" | "pilotage" | "equipe";
export type Planet = { slug: PlanetSlug; icon: LucideIcon; title: string; tagline: string; points: [string, string][] };

export const planets: Planet[] = [
  { slug: "methode", icon: Route, title: "La méthode", tagline: "48 h pour valider, 2 tours inclus, calendrier gelé à J−7.", points: [
    ["48 heures pour valider", "Rappels à 24 h et à 6 h. Sans réponse, le contenu est validé, avec un reçu daté."],
    ["Deux tours de retouche inclus", "À partir du troisième, le tour est marqué hors forfait, prêt à facturer."],
    ["Échéances à rebours", "Brief à J−14, envoi à J−7, validation à J−5, prêt à J−1, calculés depuis la date de publication."],
    ["Qui doit agir, toujours visible", "Le studio ou le client : le logiciel le déduit du statut, personne ne le saisit."],
  ] },
  { slug: "portail", icon: Smartphone, title: "Portail client", tagline: "Vos clients valident depuis leur téléphone, à votre marque.", points: [
    ["Valider en un geste", "Le client ouvre le lien, regarde, valide ou demande une retouche. Rien à installer."],
    ["Prévenu là où il lit", "Une alerte WhatsApp ou un e-mail dès que le contenu est prêt."],
    ["Devis, factures et contrats", "Au même endroit ; le contrat s’accepte dans le portail."],
    ["À votre image", "Votre logo et votre couleur, en français, en anglais ou en arabe."],
  ] },
  { slug: "publication", icon: Send, title: "Publication", tagline: "Facebook et Instagram, à l’heure prévue.", points: [
    ["Facebook et Instagram", "Publications, carrousels, reels et stories, maintenant ou à l’heure prévue."],
    ["Publications répétées", "Une série chaque semaine ou chaque mois, validée par le client."],
    ["Analyse Instagram", "Analyse d’un compte et recherche de créateurs, avec un rapport à partager."],
    ["Bientôt", "TikTok et YouTube."],
  ] },
  { slug: "one", icon: Sparkles, title: "One, l’assistant", tagline: "Il agit pour vous, en français, darija, arabe et anglais.", points: [
    ["Il agit, il ne fait pas que répondre", "Il crée et modifie des tâches, commente et prépare les dossiers Drive des clients."],
    ["Avec les mêmes droits qu’un clic", "Il ne voit et ne fait que ce que votre rôle permet, et ne contourne jamais les règles."],
    ["Dans votre langue", "Français, darija, arabe et anglais, comme on les écrit vraiment."],
    ["Il retient vos règles maison", "Les propriétaires lui apprennent les habitudes du studio."],
  ] },
  { slug: "pilotage", icon: Gauge, title: "Pilotage", tagline: "Six indicateurs pour savoir si l’agence tient ses promesses.", points: [
    ["À l’heure et validation médiane", "Objectifs suivis : 95 % des contenus à l’heure, validés en 24 h en médiane."],
    ["Validé par silence", "La part des contenus validés sans réponse, à garder sous 30 %."],
    ["Tours par contenu", "La moyenne des retouches, objectif 1,4 au plus."],
    ["Livré, vendu, réserve", "Livré par rapport au vendu, et trois contenus d’avance par client."],
  ] },
  { slug: "equipe", icon: ShieldCheck, title: "Équipe et sécurité", tagline: "Six rôles, chaque entreprise isolée, tout l’historique.", points: [
    ["Six rôles", "Propriétaire, administrateur, membre, social media manager, observateur, client."],
    ["Validation interne d’abord", "Chaque livrable passe par le studio avant d’arriver au client."],
    ["Réunions, Drive et bibliothèque", "Réunions vidéo intégrées, un dossier Drive par client, vos prompts et liens partagés."],
    ["Chaque entreprise isolée", "Mots de passe chiffrés, historique complet, suppression des données sur demande."],
  ] },
];

export const planetHref = (slug: PlanetSlug) => `/espace/${slug}`;
