import type { CSSProperties } from "react";
import { useAssetResolver } from "./assets";
import { cssVar } from "./theme/brand-theme-provider";

export type BackgroundTreatment =
  | "subtle"
  | "faded"
  | "duotone"
  | "spotlight";

const TREATMENT_STYLES: Record<
  BackgroundTreatment,
  {
    image: CSSProperties;
    wash: CSSProperties;
    scrim: CSSProperties;
  }
> = {
  subtle: {
    image: {
      opacity: 0.24,
      filter: "saturate(0.95) contrast(0.95)",
    },
    wash: {
      background: `linear-gradient(170deg, ${cssVar("bg")}, rgba(255,255,255,0.42) 58%)`,
      opacity: 0.7,
    },
    scrim: {
      background:
        "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.24) 52%, rgba(255,255,255,0.42) 100%)",
    },
  },
  faded: {
    image: {
      opacity: 0.15,
      filter: "grayscale(0.35) saturate(0.75) brightness(0.92)",
    },
    wash: {
      background: cssVar("bg"),
      opacity: 0.78,
    },
    scrim: {
      background:
        "linear-gradient(180deg, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0.3) 55%, rgba(0,0,0,0.48) 100%)",
    },
  },
  duotone: {
    image: {
      opacity: 0.2,
      filter: "grayscale(1) contrast(1.08)",
    },
    wash: {
      background: `linear-gradient(160deg, ${cssVar("accent")}, ${cssVar("bg")})`,
      mixBlendMode: "multiply",
      opacity: 0.38,
    },
    scrim: {
      background:
        "linear-gradient(180deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.38) 56%, rgba(0,0,0,0.56) 100%)",
    },
  },
  spotlight: {
    image: {
      opacity: 0.2,
      filter: "saturate(0.9) brightness(0.94)",
    },
    wash: {
      background:
        "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.16) 0%, rgba(0,0,0,0) 44%, rgba(0,0,0,0.26) 100%)",
      opacity: 1,
    },
    scrim: {
      background:
        "linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.34) 52%, rgba(0,0,0,0.54) 100%)",
    },
  },
};

export function BackgroundMediaLayer({
  assetRef,
  treatment,
}: {
  assetRef?: string;
  treatment?: BackgroundTreatment;
}) {
  const resolver = useAssetResolver();
  if (!assetRef) return null;
  const url = resolver.resolve(assetRef);
  const style = TREATMENT_STYLES[treatment ?? "subtle"];
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            ...style.image,
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(150deg, ${cssVar("placeholderA")}, ${cssVar("placeholderB")})`,
            ...style.image,
          }}
        />
      )}
      <div style={{ position: "absolute", inset: 0, ...style.wash }} />
      <div style={{ position: "absolute", inset: 0, ...style.scrim }} />
    </div>
  );
}
