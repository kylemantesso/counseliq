"use client";

import { useEffect, useRef } from "react";

export function RenderedVideoSurface({
  url,
  onEnd,
  contentFit = "contain",
}: {
  url: string;
  onEnd?: () => void;
  contentFit?: "contain" | "cover";
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const result = video.play();
    if (result && typeof result.catch === "function") {
      result.catch(() => {
        // Browsers can block audible autoplay; controls remain available.
      });
    }
  }, [url]);

  return (
    <video
      ref={ref}
      src={url}
      autoPlay
      controls
      playsInline
      preload="metadata"
      onEnded={onEnd}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        objectFit: contentFit,
        backgroundColor: "#000000",
      }}
    />
  );
}
