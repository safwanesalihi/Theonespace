import { ImageResponse } from "next/og";

// The link preview of the public page (WhatsApp, LinkedIn, X…): the landing hero in one image.
export const alt = "The One Space — vos clients valident en 48 h. Sinon, c’est validé.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", padding: 72, background: "radial-gradient(ellipse 60% 70% at 78% 45%, rgba(201,154,75,0.32), #070708 70%)", color: "#f6f0e4", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 700 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30 }}>
            <div style={{ width: 40, height: 40, borderRadius: 40, background: "#c99a4b" }} />
            <span style={{ fontWeight: 600 }}>The One Space</span>
            <span style={{ color: "#a39b8e", fontSize: 22 }}>par The One Core</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
            <span>Vos clients valident en 48 h.</span>
            <span style={{ color: "#e2b766" }}>Sinon, c’est validé.</span>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 24, color: "#c9c1b3" }}>
            <span>48 h pour valider</span><span>·</span><span>2 tours inclus</span><span>·</span><span>J−7 calendrier gelé</span>
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 360, height: 360, borderRadius: 360, border: "2px solid rgba(201,154,75,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 230, height: 230, borderRadius: 230, border: "2px dashed rgba(201,154,75,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 110, height: 110, borderRadius: 110, background: "#c99a4b", boxShadow: "0 0 80px rgba(226,183,102,0.7)" }} />
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
