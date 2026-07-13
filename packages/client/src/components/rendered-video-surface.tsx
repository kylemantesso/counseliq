"use client";

import { useEffect } from "react";
import { VideoView, useVideoPlayer } from "expo-video";

export function RenderedVideoSurface({
  url,
  onEnd,
  contentFit = "contain",
}: {
  url: string;
  onEnd?: () => void;
  contentFit?: "contain" | "cover";
}) {
  const player = useVideoPlayer({ uri: url }, (instance) => {
    instance.loop = false;
  });

  useEffect(() => {
    player.play();
  }, [player, url]);

  useEffect(() => {
    const subscription = player.addListener("playToEnd", () => onEnd?.());
    return () => subscription.remove();
  }, [onEnd, player]);

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit={contentFit}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
