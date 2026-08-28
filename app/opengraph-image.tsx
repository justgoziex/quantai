import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const runtime = "edge";
export const alt = SITE.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* Branded social card — dark ink ground, amber accent, product tagline. */
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0B0A08",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          {/*
            The real Signal Q mark, drawn from the same paths as the brand SVG.

            This was a rounded amber tile with a letter Q in it — a stand-in
            that shipped as the logo on every link shared to WhatsApp, X and
            Facebook, which is the one place the mark is seen by people who
            have never been to the site.
          */}
          <svg width="64" height="64" viewBox="0 0 64 64">
            <path
              d="M 37.45 47.13 A 20 20 0 1 1 47.13 37.45"
              fill="none"
              stroke="#E9E6DD"
              strokeWidth="7"
            />
            <path d="M25.5 25.5 L55.5 55.5" stroke="#EEA02B" strokeWidth="7" />
          </svg>
          <div style={{ color: "#E9E6DD", fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>
            Quant AI
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              color: "#E9E6DD",
              fontSize: 62,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -1.5,
              maxWidth: 900,
            }}
          >
            Signal-grade screening on Solana, Ethereum &amp; BNB Chain
          </div>
          <div style={{ color: "#8B877C", fontSize: 28, maxWidth: 860 }}>
            New pairs, ten on-chain risk gates, transparent 0–100 scoring — analytics, not advice.
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {["Solana", "Ethereum", "BNB Chain", "Base"].map((t) => (
            <div
              key={t}
              style={{
                color: "#8B877C",
                fontSize: 22,
                border: "1px solid #363430",
                borderRadius: 999,
                padding: "8px 18px",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
