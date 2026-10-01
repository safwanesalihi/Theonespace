import type { Metadata } from "next";
import "./globals.css";
import "./modern.css";
import "./team.css";
import "./login.css";
import "./date-picker.css";
import "./flow.css";
import "./print.css";
import "./invoice.css";
// Loaded last on purpose: the design tokens and the contrast floor have to win
// the cascade over the per-file copies of the glassmorphism pass. See app/tokens.css.
import "./tokens.css";
import "./experience.css";
import "./theme.css";
import { LocaleProvider } from "./locale-provider";
import { ThemeProvider } from "./theme-provider";
export const metadata: Metadata = { title: "The One Tracker — The One Core", description: "Votre espace de production et de validation client.", icons: {icon: "/favicon.svg"}, authors: [{ name: "The One Core" }], creator: "The One Core", publisher: "The One Core" };
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="fr" data-theme="light" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('one-core-theme');var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.classList.toggle('dark',d)}catch(e){}})()` }} /></head>
    <body><LocaleProvider><ThemeProvider>{children}</ThemeProvider></LocaleProvider></body>
  </html>;
}
