import { createContext, useContext, type CSSProperties } from "react";
import { cssVar } from "./theme/brand-theme-provider";

/**
 * Image resolution seam. Card props carry loose `imageRef` strings (today:
 * arbitrary compiler output; later: object-store keys the host presigns).
 * The host provides a resolver; unresolved refs render a themed placeholder
 * so cards stay reviewable without an image pipeline.
 */

export interface AssetResolver {
  resolve(ref: string): string | null;
}

const NULL_RESOLVER: AssetResolver = { resolve: () => null };

export const AssetResolverContext = createContext<AssetResolver>(NULL_RESOLVER);

export function useAssetResolver(): AssetResolver {
  return useContext(AssetResolverContext);
}

export interface CardImageProps {
  imageRef?: string;
  alt: string;
  style?: CSSProperties;
}

export function CardImage({ imageRef, alt, style }: CardImageProps) {
  const resolver = useAssetResolver();
  const url = imageRef ? resolver.resolve(imageRef) : null;

  if (url) {
    return (
      <img
        src={url}
        alt={alt}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: cssVar("imageFilter"),
          ...style,
        }}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={alt}
      data-ciq-image-placeholder=""
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "flex-end",
        padding: 10,
        background: `linear-gradient(135deg, ${cssVar("placeholderA")}, ${cssVar("placeholderB")})`,
        ...style,
      }}
    >
      {imageRef ? (
        <span
          style={{
            fontFamily: cssVar("fontMono"),
            fontSize: 9,
            letterSpacing: "0.06em",
            color: cssVar("dim"),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "100%",
          }}
        >
          {imageRef}
        </span>
      ) : null}
    </div>
  );
}
