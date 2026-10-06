import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// Content-Security-Policy: what the browser may load and talk to. The app talks only to itself and to
// Daily (meetings) and Google Picker (its loader and Drive selection iframe); print documents use Google Fonts; pictures and videos come from many
// networks (social account pictures, Drive, Instagram thumbnails), so any https image is allowed —
// but only the Picker origin may supply external scripts; no plugins, <base> or form hijacking, or framing by other sites.
// Dev adds what Next's hot reload needs (eval, websocket).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://apis.google.com${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  `connect-src 'self' https://*.daily.co wss://*.daily.co https://apis.google.com${dev ? " ws: http://127.0.0.1:* http://localhost:*" : ""}`,
  "frame-src 'self' https://*.daily.co https://docs.google.com https://apis.google.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // allow-popups (not same-origin): Google Picker and Daily open popups that must keep their opener.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera, microphone and screen sharing stay available (meetings, voice messages); the rest is off.
  { key: "Permissions-Policy", value: "geolocation=(), payment=(), usb=(), serial=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  // The embedded Postgres used for local development loads its WASM from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  poweredByHeader: false,
  async headers() {
    return [
      // Everything but the finance export, which sends its own, stricter sandbox policy.
      { source: "/((?!admin/finance/data).*)", headers: securityHeaders },
      { source: "/admin/finance/data", headers: securityHeaders.filter((h) => h.key !== "Content-Security-Policy") },
    ];
  },
};

export default nextConfig;
