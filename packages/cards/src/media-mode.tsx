import { createContext, useContext } from "react";

export type MediaMode = "browser" | "static";

const MediaModeContext = createContext<MediaMode>("browser");

export const MediaModeProvider = MediaModeContext.Provider;

export function useMediaMode(): MediaMode {
  return useContext(MediaModeContext);
}
