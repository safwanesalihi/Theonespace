// The landing's two display faces, self-hosted by next/font at build time (the CSP allows fonts from
// 'self'): Instrument Serif for the headlines, Caveat for the handwritten labels. Everything else keeps
// the app's own faces (styles/design-tokens.css), Thmanyah Sans included for Arabic.
import { Caveat, Instrument_Serif } from "next/font/google";

export const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--ts-serif", display: "swap" });
export const hand = Caveat({ subsets: ["latin"], weight: "500", variable: "--ts-hand", display: "swap" });
export const landingFonts = `${serif.variable} ${hand.variable}`;
