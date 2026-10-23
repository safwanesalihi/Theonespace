import type { Metadata } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./styles.css";
import { LocaleProvider } from "@/lib/i18n/locale-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { themeBootstrap } from '@/lib/theme';
import { startupRecovery } from '@/lib/startup-recovery';
export const metadata: Metadata = { title: "The One Space", description: "Votre espace de production et de validation client.", icons: {icon: "/favicon.svg"}, authors: [{ name: "The One Core" }], creator: "The One Core", publisher: "The One Core" };
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
// The landing's display face, for page titles only (--t-font-display).
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="fr" data-theme="light" className={`${geist.variable} ${serif.variable}`} suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: startupRecovery }} /><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
    <body><LocaleProvider><ThemeProvider>{children}</ThemeProvider></LocaleProvider></body>
  </html>;
}
