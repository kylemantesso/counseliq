import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { AssetResolverContext, type AssetResolver } from "../src/assets";
import { CardVideo } from "../src/card-video";
import { VideoCard } from "../src/templates/video-card";
import { BrandThemeProvider } from "../src/theme/brand-theme-provider";
import { SETTLED_TIMING, type CardTiming } from "../src/timing";

/**
 * CardVideo behaviour: playback is a pure function of `timing.media` —
 * play inside the window, hold past it, poster under reduced motion,
 * seek only past the drift tolerance. jsdom has no playback engine, so
 * play/pause are stubbed on the prototype and currentTime is set directly.
 */

const RESOLVER: AssetResolver = {
  resolve: (ref) =>
    ref.startsWith("poster:")
      ? `https://cdn.test/${ref.slice(7)}.jpg`
      : `https://cdn.test/${ref}.mp4`,
};

const NULL_RESOLVER: AssetResolver = { resolve: () => null };

let playSpy: ReturnType<typeof vi.fn>;
let pauseSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  playSpy = vi.fn().mockResolvedValue(undefined);
  pauseSpy = vi.fn().mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { value: true, configurable: true });
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: function (this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { value: false, configurable: true });
      return playSpy();
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: pauseSpy,
  });
});

afterEach(() => {
  delete (HTMLMediaElement.prototype as { play?: unknown }).play;
  delete (HTMLMediaElement.prototype as { pause?: unknown }).pause;
});

function timing(overrides: Partial<CardTiming> = {}): CardTiming {
  return {
    localMs: 500,
    progress: 0.2,
    beatsRevealed: 0.5,
    reducedMotion: false,
    ...overrides,
  };
}

function renderVideo(node: ReactNode, resolver: AssetResolver = RESOLVER) {
  return render(
    <AssetResolverContext.Provider value={resolver}>
      <BrandThemeProvider>{node}</BrandThemeProvider>
    </AssetResolverContext.Provider>
  );
}

function videoEl(container: HTMLElement): HTMLVideoElement {
  const el = container.querySelector("video");
  expect(el).not.toBeNull();
  return el as HTMLVideoElement;
}

describe("CardVideo", () => {
  test("renders muted, playsInline, poster + src from the resolver", () => {
    const { container } = renderVideo(
      <CardVideo assetRef="asset1" alt="b-roll" timing={SETTLED_TIMING} />
    );
    const el = videoEl(container);
    expect(el.muted).toBe(true);
    expect(el.getAttribute("playsinline")).not.toBeNull();
    expect(el.getAttribute("src")).toBe("https://cdn.test/asset1.mp4");
    expect(el.getAttribute("poster")).toBe("https://cdn.test/asset1.jpg");
  });

  test("plays while inside the media window", () => {
    const { container } = renderVideo(
      <CardVideo
        assetRef="asset1"
        alt="b-roll"
        timing={timing({ media: { positionMs: 500, durationMs: 4000 } })}
      />
    );
    videoEl(container);
    expect(playSpy).toHaveBeenCalled();
  });

  test("holds (pauses) once positionMs reaches durationMs — no loop", () => {
    const { container, rerender } = renderVideo(
      <CardVideo
        assetRef="asset1"
        alt="b-roll"
        timing={timing({ media: { positionMs: 3900, durationMs: 4000 } })}
      />
    );
    const el = videoEl(container);
    el.currentTime = 3.9;
    rerender(
      <AssetResolverContext.Provider value={RESOLVER}>
        <BrandThemeProvider>
          <CardVideo
            assetRef="asset1"
            alt="b-roll"
            timing={timing({ media: { positionMs: 4000, durationMs: 4000 } })}
          />
        </BrandThemeProvider>
      </AssetResolverContext.Provider>
    );
    expect(pauseSpy).toHaveBeenCalled();
    // Held on its last frame, not rewound.
    expect(el.currentTime).toBeCloseTo(3.9, 3);
  });

  test("seeks only past the drift tolerance", () => {
    const { container, rerender } = renderVideo(
      <CardVideo
        assetRef="asset1"
        alt="b-roll"
        timing={timing({ media: { positionMs: 1000, durationMs: 8000 } })}
      />
    );
    const el = videoEl(container);
    // Within tolerance: element position left alone.
    el.currentTime = 1.1;
    rerender(
      <AssetResolverContext.Provider value={RESOLVER}>
        <BrandThemeProvider>
          <CardVideo
            assetRef="asset1"
            alt="b-roll"
            timing={timing({ media: { positionMs: 1200, durationMs: 8000 } })}
          />
        </BrandThemeProvider>
      </AssetResolverContext.Provider>
    );
    expect(el.currentTime).toBeCloseTo(1.1, 3);
    // A scrub far away snaps the element to the host clock.
    rerender(
      <AssetResolverContext.Provider value={RESOLVER}>
        <BrandThemeProvider>
          <CardVideo
            assetRef="asset1"
            alt="b-roll"
            timing={timing({ media: { positionMs: 6000, durationMs: 8000 } })}
          />
        </BrandThemeProvider>
      </AssetResolverContext.Provider>
    );
    expect(el.currentTime).toBeCloseTo(6, 3);
  });

  test("reduced motion never plays — poster stays", () => {
    renderVideo(
      <CardVideo
        assetRef="asset1"
        alt="b-roll"
        timing={timing({
          reducedMotion: true,
          media: { positionMs: 500, durationMs: 4000 },
        })}
      />
    );
    expect(playSpy).not.toHaveBeenCalled();
  });

  test("no media window (static preview) never plays", () => {
    renderVideo(
      <CardVideo assetRef="asset1" alt="b-roll" timing={SETTLED_TIMING} />
    );
    expect(playSpy).not.toHaveBeenCalled();
  });

  test("unresolved ref renders the themed placeholder, no <video>", () => {
    const { container } = renderVideo(
      <CardVideo assetRef="asset1" alt="b-roll" timing={SETTLED_TIMING} />,
      NULL_RESOLVER
    );
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("[data-ciq-image-placeholder]")).not.toBeNull();
  });
});

describe("video-card template", () => {
  const props = {
    assetRef: "asset1",
    overlayText: "Inside the simulation wards",
    sourceLabel: "University media kit",
  };

  test("renders overlay text and source label over the video", () => {
    const { container } = renderVideo(
      <VideoCard props={props} timing={SETTLED_TIMING} />
    );
    expect(container.textContent).toContain("Inside the simulation wards");
    expect(container.textContent).toContain("University media kit");
    expect(videoEl(container).muted).toBe(true);
  });

  test("plays through the template when its media window is active", () => {
    renderVideo(
      <VideoCard
        props={props}
        timing={timing({ media: { positionMs: 100, durationMs: 2000 } })}
      />
    );
    expect(playSpy).toHaveBeenCalled();
  });
});
