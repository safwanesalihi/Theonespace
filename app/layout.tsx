import type { Metadata } from "next";
import "./styles.css";
import { LocaleProvider } from "./locale-provider";
import { ThemeProvider } from "./theme-provider";
export const metadata: Metadata = { title: "The One Tracker — The One Core", description: "Votre espace de production et de validation client.", icons: {icon: "/favicon.svg"}, authors: [{ name: "The One Core" }], creator: "The One Core", publisher: "The One Core" };
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="fr" data-theme="light" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('one-core-theme');var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.classList.toggle('dark',d)}catch(e){}})()` }} /></head>
    <body><LocaleProvider><ThemeProvider>{children}</ThemeProvider></LocaleProvider></body>
  </html>;
}
