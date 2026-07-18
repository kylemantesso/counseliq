import type { ComponentType, CSSProperties, ReactNode } from "react";
import { CardVideo } from "./card-video";
import { beatProgress, fade, fadeUp, growX, growY, msWindow, pop, settle } from "./interpolate";
import { cssVar } from "./theme/brand-theme-provider";
import type { CardComponentProps, CardTiming } from "./timing";

/**
 * Presenter-video treatments from the La Trobe overlay card library. This is
 * deliberately separate from TEMPLATE_COMPONENTS: callers opt into this
 * family without changing the standard, schema-bound card renderer.
 */
export const AVATAR_OVERLAY_TEMPLATES = [
  "title-card",
  "stat-card",
  "list-reveal",
  "comparison-split",
  "quote-card",
  "map-card",
  "timeline-card",
  "takeaway-card",
  "pathway-card",
  "persona-card",
  "alert-card",
  "breakdown-card",
  "myth-fact-card",
  "text-card",
] as const;

export type AvatarOverlayTemplate = (typeof AVATAR_OVERLAY_TEMPLATES)[number];
export type AvatarOverlayProps = Record<string, unknown>;
export type AvatarOverlayTemplateComponent = ComponentType<CardComponentProps<AvatarOverlayProps>>;

export interface AvatarOverlayCardProps {
  template: string;
  props: AvatarOverlayProps;
  timing: CardTiming;
}

const display: CSSProperties = {
  fontFamily: cssVar("fontDisplay"),
  fontWeight: cssVar("displayWeight") as CSSProperties["fontWeight"],
  textTransform: cssVar("titleCase") as CSSProperties["textTransform"],
  letterSpacing: cssVar("tracking"),
};

const mono: CSSProperties = {
  fontFamily: cssVar("fontMono"),
  fontSize: 11,
  letterSpacing: ".18em",
  textTransform: "uppercase",
};

const photoText = cssVar("photoInk");
const photoDim = "color-mix(in srgb, var(--ciq-photo-ink) 70%, transparent)";
const photoFaint = "color-mix(in srgb, var(--ciq-photo-ink) 52%, transparent)";
const photoRule = "color-mix(in srgb, var(--ciq-photo-ink) 28%, transparent)";
const glass = "color-mix(in srgb, var(--ciq-scrim) 78%, transparent)";
const glassBorder = "color-mix(in srgb, var(--ciq-photo-ink) 26%, transparent)";
const textShadow = "0 2px 16px rgba(0,0,0,.45)";

function string(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function prop(props: AvatarOverlayProps, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = string(props[key]);
    if (value) return value;
  }
  return null;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const direct = string(entry);
    if (direct) return [direct];
    if (entry && typeof entry === "object") {
      const record = entry as AvatarOverlayProps;
      const text = prop(record, "text", "label", "title", "name");
      return text ? [text] : [];
    }
    return [];
  });
}

function records(value: unknown): AvatarOverlayProps[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is AvatarOverlayProps => typeof entry === "object" && entry !== null && !Array.isArray(entry)
  );
}

function assetRef(props: AvatarOverlayProps): string | undefined {
  return prop(
    props,
    "avatarAssetRef",
    "avatarRef",
    "avatarVideoRef",
    "presenterAssetRef",
    "presenterRef",
    "presenterVideoRef",
    "videoAssetRef",
    "videoRef",
    "assetRef",
    "bgAssetRef"
  ) ?? undefined;
}

function badge(text: string, timing: CardTiming, delay = 100) {
  return (
    <span
      style={{
        display: "inline-block",
        ...mono,
        color: photoText,
        background: cssVar("accent"),
        padding: "5px 10px",
        borderRadius: cssVar("radiusSm"),
        ...fade(msWindow(timing, delay, 500)),
      }}
    >
      {text}
    </span>
  );
}

function AvatarOverlayShell({
  template,
  props,
  timing,
  children,
  treatment = "integrated",
}: {
  template: AvatarOverlayTemplate;
  props: AvatarOverlayProps;
  timing: CardTiming;
  children: ReactNode;
  treatment?: "integrated" | "full" | "glass";
}) {
  const full = treatment === "full";
  return (
    <div
      data-ciq-avatar-overlay-card={template}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: cssVar("frame"),
        color: photoText,
        fontFamily: cssVar("fontText"),
      }}
    >
      <CardVideo
        assetRef={assetRef(props)}
        alt={prop(props, "avatarAlt", "presenterAlt", "videoAlt") ?? "Presenter video"}
        timing={timing}
        style={{ position: "absolute", inset: 0 }}
      />
      {full ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: `linear-gradient(to bottom, ${cssVar("scrim")}, ${cssVar("scrim")})`,
            ...fade(msWindow(timing, 0, 400)),
          }}
        />
      ) : (
        <>
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: treatment === "glass" ? "32%" : "30%",
              pointerEvents: "none",
              background: `linear-gradient(to bottom, ${cssVar("scrim")}, transparent)`,
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: treatment === "glass" ? "62%" : "76%",
              pointerEvents: "none",
              background: `linear-gradient(to top, ${cssVar("scrim")}, transparent)`,
            }}
          />
        </>
      )}
      {children}
    </div>
  );
}

function Integrated({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 30,
        right: 30,
        bottom: 108,
        zIndex: 1,
      }}
    >
      {children}
    </div>
  );
}

function GlassPanel({ children, timing }: { children: ReactNode; timing: CardTiming }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 22,
        right: 22,
        bottom: 108,
        zIndex: 1,
        background: glass,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: `1px solid ${glassBorder}`,
        borderRadius: "14px",
        boxShadow: "0 16px 40px rgba(0,0,0,.4)",
        ...fadeUp(msWindow(timing, 300, 500)),
      }}
    >
      {children}
    </div>
  );
}

function TitleOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const title = prop(props, "title", "headline") ?? prop(props, "kicker") ?? "";
  const kicker = title === prop(props, "kicker") ? null : prop(props, "kicker", "module", "label");
  const course = prop(props, "courseLabel", "course", "footerLabel");
  const position = prop(props, "positionLabel", "indexLabel", "counterLabel", "progressLabel");
  return (
    <AvatarOverlayShell template="title-card" props={props} timing={timing}>
      {kicker ? <div style={{ position: "absolute", top: 30, left: 30, right: 76, zIndex: 1 }}>{badge(kicker, timing)}</div> : null}
      <Integrated>
        <div style={{ width: 44, height: 3, background: cssVar("accent"), ...growX(msWindow(timing, 300, 500)) }} />
        <div style={{ ...display, fontSize: 47, lineHeight: 1.06, marginTop: 20, textShadow, overflowWrap: "break-word", ...fadeUp(msWindow(timing, 380, 550)) }}>
          {title}
        </div>
        {course || position ? (
          <div style={{ marginTop: 22, borderTop: `1px solid ${photoRule}`, paddingTop: 14, display: "flex", justifyContent: course && position ? "space-between" : "flex-start", gap: 12, alignItems: "baseline", ...fade(msWindow(timing, 750, 500)) }}>
            {course ? <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: photoDim }}>{course}</span> : null}
            {position ? <span style={{ ...mono, fontSize: 11, color: photoDim, whiteSpace: "nowrap" }}>{position}</span> : null}
          </div>
        ) : null}
      </Integrated>
    </AvatarOverlayShell>
  );
}

function StatOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const kicker = prop(props, "kicker", "label", "heading");
  const headline = prop(props, "headline", "stat", "value") ?? "";
  const supporting = prop(props, "supporting", "body", "detail");
  const source = prop(props, "sourceLabel", "source", "citation");
  return (
    <AvatarOverlayShell template="stat-card" props={props} timing={timing}>
      {kicker ? <div style={{ position: "absolute", top: 30, left: 30, right: 76, zIndex: 1 }}>{badge(kicker, timing)}</div> : null}
      <Integrated>
        <div style={{ ...display, fontSize: 76, lineHeight: ".92", textShadow, overflowWrap: "break-word", ...settle(msWindow(timing, 200, 700)) }}>{headline}</div>
        <div style={{ width: 44, height: 3, background: cssVar("accent"), margin: "18px 0 16px", ...growX(msWindow(timing, 600, 500)) }} />
        {supporting ? <div style={{ fontSize: 21, maxWidth: 230, lineHeight: 1.32, color: photoDim, ...fadeUp(msWindow(timing, 720, 500)) }}>{supporting}</div> : null}
        {source ? <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 20, ...fade(msWindow(timing, 1200, 600)) }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: cssVar("accent") }} /><span style={{ ...mono, fontSize: 10, color: photoFaint }}>{source}</span></div> : null}
      </Integrated>
    </AvatarOverlayShell>
  );
}

function ListOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const heading = prop(props, "heading", "title", "kicker");
  const items = strings(props.items);
  return (
    <AvatarOverlayShell template="list-reveal" props={props} timing={timing}>
      {heading ? <div style={{ position: "absolute", top: 30, left: 30, right: 30, zIndex: 1, ...display, fontSize: 33, lineHeight: 1.1, textShadow, ...fadeUp(msWindow(timing, 100, 500)) }}>{heading}</div> : null}
      <Integrated>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {items.map((item, index) => <div key={index} data-ciq-avatar-overlay-beat={index} style={{ display: "flex", gap: 15, alignItems: "baseline", padding: "15px 0", borderTop: `1px solid ${photoRule}`, borderBottom: index === items.length - 1 ? `1px solid ${photoRule}` : undefined, ...fadeUp(beatProgress(timing, index)) }}><span style={{ ...mono, fontSize: 12, color: cssVar("accent") }}>{String(index + 1).padStart(2, "0")}</span><span style={{ fontSize: 19, fontWeight: 600 }}>{item}</span></div>)}
        </div>
      </Integrated>
    </AvatarOverlayShell>
  );
}

function ComparisonOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const kicker = prop(props, "kicker", "heading", "title");
  const leftHeading = prop(props, "leftHeading", "leftLabel");
  const rightHeading = prop(props, "rightHeading", "rightLabel");
  const left = strings(props.leftItems);
  const right = strings(props.rightItems);
  const leftValue = prop(props, "leftValue", "leftStat") ?? left.join(" ");
  const rightValue = prop(props, "rightValue", "rightStat") ?? right.join(" ");
  const detail = prop(props, "supporting", "detail", "rightDetail");
  return (
    <AvatarOverlayShell template="comparison-split" props={props} timing={timing}>
      {kicker ? <div style={{ position: "absolute", top: 30, left: 30, right: 76, zIndex: 1 }}>{badge(kicker, timing)}</div> : null}
      <Integrated>
        <div data-ciq-avatar-overlay-beat={0} style={{ ...fadeUp(beatProgress(timing, 0)) }}>{leftHeading ? <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: photoDim, marginBottom: 6 }}>{leftHeading}</div> : null}<div style={{ ...display, fontSize: 60, lineHeight: ".95", textShadow }}>{leftValue}</div></div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "18px 0", ...fade(msWindow(timing, 600, 400)) }}><span style={{ flex: 1, height: 1, background: photoRule }} /><span style={{ ...mono, fontSize: 11, color: photoFaint }}>vs</span><span style={{ flex: 1, height: 1, background: photoRule }} /></div>
        <div data-ciq-avatar-overlay-beat={1} style={{ ...fadeUp(beatProgress(timing, 1)) }}>{rightHeading ? <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: photoDim, marginBottom: 6 }}>{rightHeading}</div> : null}<div style={{ ...display, fontSize: 60, lineHeight: ".95", color: cssVar("accent"), textShadow }}>{rightValue}</div>{detail ? <div style={{ fontSize: 15, color: photoDim, marginTop: 8 }}>{detail}</div> : null}</div>
      </Integrated>
    </AvatarOverlayShell>
  );
}

function QuoteOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const quote = prop(props, "quote", "text", "body") ?? "";
  const attribution = prop(props, "attribution", "author", "name");
  const source = prop(props, "sourceLabel", "source", "role");
  return <AvatarOverlayShell template="quote-card" props={props} timing={timing}><Integrated><div aria-hidden style={{ ...display, fontSize: 92, lineHeight: ".5", color: cssVar("accent"), ...fade(msWindow(timing, 100, 500)) }}>&ldquo;</div><div style={{ ...display, marginTop: 22, fontSize: 31, lineHeight: 1.24, textShadow, ...fadeUp(msWindow(timing, 300, 550)) }}>{quote}</div>{attribution || source ? <div style={{ borderTop: `1px solid ${photoRule}`, marginTop: 22, paddingTop: 14, ...fade(msWindow(timing, 850, 500)) }}>{attribution ? <div style={{ fontSize: 16, fontWeight: 600 }}>{attribution}</div> : null}{source ? <div style={{ fontSize: 13, color: photoDim, marginTop: 3 }}>{source}</div> : null}</div> : null}</Integrated></AvatarOverlayShell>;
}

const markerPositions = [
  { left: "10%", top: "14%" }, { left: "48%", top: "26%" }, { left: "60%", top: "42%" }, { left: "30%", top: "55%" }, { left: "42%", top: "76%" }, { left: "14%", top: "38%" }, { left: "66%", top: "62%" }, { left: "22%", top: "70%" },
] as const;

function MapOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const label = prop(props, "kicker", "label", "heading") ?? "Campus network";
  const region = prop(props, "region", "title") ?? "";
  const markers = strings(props.markers).slice(0, markerPositions.length);
  const caption = prop(props, "caption", "supporting", "detail");
  return <AvatarOverlayShell template="map-card" props={props} timing={timing} treatment="full"><div style={{ position: "absolute", inset: 0, zIndex: 1, display: "flex", flexDirection: "column", padding: "32px 30px 108px" }}><div style={{ ...mono, fontSize: 12, color: photoDim, ...fade(msWindow(timing, 100, 500)) }}>{label}</div><div style={{ ...display, fontSize: 38, lineHeight: 1.08, marginTop: 8, ...fadeUp(msWindow(timing, 200, 500)) }}>{region}</div><div style={{ position: "relative", flex: 1, marginTop: 16 }}><div aria-hidden style={{ position: "absolute", inset: "2%", background: "color-mix(in srgb, var(--ciq-photo-ink) 8%, transparent)", border: `1px solid ${photoRule}`, borderRadius: "58% 42% 55% 45% / 42% 52% 48% 58%", ...fade(msWindow(timing, 300, 700)) }} />{markers.map((marker, index) => <div key={marker} data-ciq-avatar-overlay-beat={index} style={{ position: "absolute", ...markerPositions[index], display: "flex", alignItems: "center", gap: 7, ...pop(beatProgress(timing, index)) }}><span style={{ width: index === markers.length - 1 ? 14 : 9, height: index === markers.length - 1 ? 14 : 9, borderRadius: "50%", background: cssVar("accent") }} /><span style={index === markers.length - 1 ? { fontSize: 14, fontWeight: 600 } : { ...mono, fontSize: 11 }}>{marker}</span></div>)}</div>{caption ? <div style={{ fontSize: 15, lineHeight: 1.3, color: photoDim, ...fade(beatProgress(timing, markers.length)) }}>{caption}</div> : null}</div></AvatarOverlayShell>;
}

function TimelineOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const heading = prop(props, "heading", "title", "kicker");
  const events = records(props.events);
  return <AvatarOverlayShell template="timeline-card" props={props} timing={timing} treatment="glass">{heading ? <div style={{ position: "absolute", top: 30, left: 30, right: 30, zIndex: 1, ...display, fontSize: 31, lineHeight: 1.1, textShadow, ...fadeUp(msWindow(timing, 100, 500)) }}>{heading}</div> : null}<GlassPanel timing={timing}><div style={{ position: "relative", padding: "18px 20px 20px 26px", display: "flex", flexDirection: "column", gap: 20 }}><div aria-hidden style={{ position: "absolute", left: 5, top: 6, bottom: 6, width: 2, background: photoRule, ...growY(timing.reducedMotion ? 1 : timing.progress) }} />{events.map((event, index) => { const last = index === events.length - 1; return <div key={index} data-ciq-avatar-overlay-beat={index} style={{ position: "relative", opacity: last ? undefined : .6, ...fadeUp(beatProgress(timing, index)) }}><span style={{ position: "absolute", left: -26, top: 3, width: 12, height: 12, borderRadius: "50%", background: last ? cssVar("accent") : cssVar("frame"), border: `3px solid ${last ? cssVar("accent") : photoFaint}` }} /><div style={{ ...mono, fontSize: 11, color: last ? cssVar("accent") : photoFaint }}>{prop(event, "date", "label", "title")}</div><div style={{ fontSize: last ? 19 : 18, fontWeight: last ? 700 : 600, marginTop: 4 }}>{prop(event, "label", "text", "title")}</div>{prop(event, "detail", "supporting", "body") ? <div style={{ fontSize: 13, color: photoDim, marginTop: 3 }}>{prop(event, "detail", "supporting", "body")}</div> : null}</div>; })}</div></GlassPanel></AvatarOverlayShell>;
}

function TakeawayOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const label = prop(props, "kicker", "heading", "label") ?? "Takeaway";
  const text = prop(props, "text", "body", "headline") ?? "";
  const saved = prop(props, "savedLabel", "footerLabel") ?? "Saved to crib deck";
  return <AvatarOverlayShell template="takeaway-card" props={props} timing={timing}><div style={{ position: "absolute", top: 30, left: 30, right: 76, zIndex: 1 }}>{badge(label, timing)}</div><Integrated><div style={{ ...display, fontSize: 33, lineHeight: 1.24, textShadow, ...fadeUp(msWindow(timing, 300, 600)) }}>{text}</div><div style={{ display: "inline-flex", alignItems: "center", gap: 9, border: `1px solid ${photoRule}`, borderRadius: 999, padding: "9px 16px", marginTop: 22, ...fadeUp(msWindow(timing, 1000, 500)) }}><span style={{ color: cssVar("accent"), fontSize: 14, lineHeight: 1 }}>✓</span><span style={{ ...mono, fontSize: 11, color: photoDim }}>{saved}</span></div></Integrated></AvatarOverlayShell>;
}

function PathwayOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const label = prop(props, "kicker", "label") ?? "Pathway";
  const heading = prop(props, "heading", "title") ?? "";
  const stageRecords = records(props.stages);
  const stages = stageRecords.length > 0 ? stageRecords.map((stage) => ({ title: prop(stage, "title", "label", "text") ?? "", detail: prop(stage, "detail", "supporting", "description") })) : strings(props.stages).map((title) => ({ title, detail: null }));
  return <AvatarOverlayShell template="pathway-card" props={props} timing={timing} treatment="glass"><div style={{ position: "absolute", top: 30, left: 30, right: 30, zIndex: 1 }}>{badge(label, timing)}<div style={{ ...display, fontSize: 32, lineHeight: 1.08, marginTop: 8, textShadow, ...fadeUp(msWindow(timing, 200, 500)) }}>{heading}</div></div><GlassPanel timing={timing}><div style={{ padding: 16, display: "flex", flexDirection: "column" }}>{stages.map((stage, index) => { const last = index === stages.length - 1; return <div key={index} style={{ display: "flex", flexDirection: "column" }}>{index > 0 ? <div aria-hidden style={{ alignSelf: "center", width: 2, height: 18, background: cssVar("accent"), ...growY(beatProgress(timing, index)) }} /> : null}<div data-ciq-avatar-overlay-beat={index} style={{ border: `${last ? 2 : 1}px solid ${last ? cssVar("accent") : photoRule}`, borderRadius: cssVar("radius"), background: last ? "color-mix(in srgb, var(--ciq-accent) 12%, transparent)" : "color-mix(in srgb, var(--ciq-photo-ink) 5%, transparent)", padding: "14px 16px", display: "flex", alignItems: "baseline", gap: 13, ...fadeUp(beatProgress(timing, index)) }}><span style={{ ...mono, fontSize: 11, color: cssVar("accent") }}>{index + 1}</span><div><div style={{ fontSize: 19, fontWeight: last ? 700 : 600 }}>{stage.title}</div>{stage.detail ? <div style={{ fontSize: 13, color: photoDim, marginTop: 1 }}>{stage.detail}</div> : null}</div></div></div>; })}</div></GlassPanel></AvatarOverlayShell>;
}

function PersonaOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const name = prop(props, "name", "title") ?? "";
  const initial = name.charAt(0).toUpperCase() || "?";
  const location = prop(props, "location", "subtitle", "detail");
  const chips = strings(props.chips);
  const prompt = prop(props, "footerPrompt", "prompt", "question");
  return <AvatarOverlayShell template="persona-card" props={props} timing={timing} treatment="glass"><GlassPanel timing={timing}><div style={{ padding: "22px" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: `1px solid ${photoRule}`, paddingBottom: 12, ...fade(msWindow(timing, 300, 500)) }}><span style={{ ...mono, color: photoDim }}>Case file</span><span style={{ ...mono, fontSize: 11, color: cssVar("accent") }}>Scenario</span></div><div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 18, ...fadeUp(msWindow(timing, 450, 500)) }}><div style={{ width: 64, height: 64, borderRadius: "50%", background: "color-mix(in srgb, var(--ciq-accent) 16%, transparent)", border: `1px solid ${cssVar("accent")}`, display: "flex", alignItems: "center", justifyContent: "center", ...display, fontSize: 28, flex: "0 0 auto" }}>{initial}</div><div><div style={{ ...display, fontSize: 30, lineHeight: 1.02 }}>{name}</div>{location ? <div style={{ fontSize: 14, color: photoDim, marginTop: 4 }}>{location}</div> : null}</div></div>{chips.length > 0 ? <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>{chips.map((chip, index) => <span key={index} data-ciq-avatar-overlay-beat={index} style={{ ...mono, fontSize: 11, border: `1px solid ${index === chips.length - 1 ? cssVar("accent") : photoRule}`, borderRadius: cssVar("radiusSm"), padding: "7px 11px", color: index === chips.length - 1 ? cssVar("accent") : photoDim, ...fadeUp(beatProgress(timing, index)) }}>{chip}</span>)}</div> : null}{prompt ? <div style={{ borderTop: `1px solid ${photoRule}`, marginTop: 18, paddingTop: 14, ...display, fontSize: 23, lineHeight: 1.2, ...fadeUp(beatProgress(timing, chips.length)) }}>{prompt}</div> : null}</div></GlassPanel></AvatarOverlayShell>;
}

function AlertOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const label = prop(props, "kicker", "heading", "label") ?? "Alert";
  const message = prop(props, "message", "body", "text") ?? "";
  const detail = prop(props, "supporting", "detail", "footer");
  return <AvatarOverlayShell template="alert-card" props={props} timing={timing} treatment="full"><div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 1, border: `7px solid ${cssVar("accent")}`, pointerEvents: "none", ...fade(msWindow(timing, 0, 400)) }} /><div style={{ position: "absolute", inset: 0, zIndex: 1, display: "flex", flexDirection: "column", padding: "44px 34px 112px" }}><div style={{ ...pop(msWindow(timing, 250, 450)) }}><svg width="46" height="42" viewBox="0 0 24 22" aria-hidden="true"><path d="M12 2 22.5 20.5 H1.5 Z" fill="none" stroke={cssVar("accent")} strokeWidth="2" strokeLinejoin="round" /><line x1="12" y1="9" x2="12" y2="14" stroke={cssVar("accent")} strokeWidth="2" /><circle cx="12" cy="17" r="1.3" fill={cssVar("accent")} /></svg></div><div style={{ ...mono, fontSize: 12, letterSpacing: ".24em", color: cssVar("accent"), marginTop: 20, ...fade(msWindow(timing, 450, 400)) }}>{label}</div><div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 20 }}><div style={{ ...display, fontSize: 32, lineHeight: 1.24, textShadow, ...fadeUp(msWindow(timing, 600, 500)) }}>{message}</div>{detail ? <div style={{ fontSize: 21, fontWeight: 700, color: cssVar("accent"), ...fadeUp(msWindow(timing, 1000, 500)) }}>{detail}</div> : null}</div></div></AvatarOverlayShell>;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function BreakdownOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const heading = prop(props, "heading", "title", "kicker");
  const parts = records(props.parts);
  const values = parts.map((part) => numeric(part.value));
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const totalLabel = prop(props, "totalLabel", "footerLabel") ?? "Total";
  const totalValue = prop(props, "total", "totalValue") ?? (total > 0 ? String(total) : null);
  return <AvatarOverlayShell template="breakdown-card" props={props} timing={timing} treatment="glass">{heading ? <div style={{ position: "absolute", top: 30, left: 30, right: 30, zIndex: 1, ...display, fontSize: 30, lineHeight: 1.1, textShadow, ...fadeUp(msWindow(timing, 100, 500)) }}>{heading}</div> : null}<GlassPanel timing={timing}><div style={{ padding: 18 }}><div style={{ display: "flex", flexDirection: "column", gap: 11, fontVariantNumeric: "tabular-nums" }}>{parts.map((part, index) => <div key={index} data-ciq-avatar-overlay-beat={index} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", ...fadeUp(beatProgress(timing, index)) }}><span style={{ fontSize: 16 }}>{prop(part, "label", "title", "name")}</span><span style={{ fontFamily: cssVar("fontMono"), fontSize: 14 }}>{prop(part, "value", "amount")}</span></div>)}</div>{parts.length > 0 ? <div style={{ display: "flex", height: 14, marginTop: 16, borderRadius: 3, overflow: "hidden", gap: 2 }}>{parts.map((_, index) => { const width = total > 0 && values[index] !== null ? ((values[index] as number) / total) * 100 : 100 / parts.length; return <div key={index} style={{ width: `${width}%` }}><div style={{ height: "100%", background: cssVar("accent"), opacity: .45 + (.55 * (index + 1)) / parts.length, ...growX(beatProgress(timing, index)) }} /></div>; })}</div> : null}{totalValue ? <div style={{ borderTop: `1px solid ${photoRule}`, marginTop: 16, paddingTop: 14, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", ...settle(msWindow(timing, 1150, 600)) }}><span style={{ fontSize: 13, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: photoDim }}>{totalLabel}</span><span style={{ ...display, fontSize: 32 }}>{totalValue}</span></div> : null}</div></GlassPanel></AvatarOverlayShell>;
}

function MythFactOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const myth = prop(props, "myth", "left", "before") ?? "";
  const fact = prop(props, "fact", "right", "after") ?? "";
  const dim = timing.reducedMotion ? .35 : 1 - .65 * msWindow(timing, 1000, 500);
  return <AvatarOverlayShell template="myth-fact-card" props={props} timing={timing}><div style={{ position: "absolute", top: 30, left: 30, right: 30, zIndex: 1, opacity: dim }}><div style={{ position: "relative", display: "inline-block", ...fade(msWindow(timing, 100, 400)) }}><span style={{ ...mono, fontSize: 12, letterSpacing: ".24em", color: photoDim }}>Myth</span><span aria-hidden style={{ position: "absolute", left: -4, right: -4, top: "50%", height: 2, background: cssVar("accent"), ...growX(msWindow(timing, 1000, 350)) }} /></div><div style={{ ...display, marginTop: 12, fontSize: 28, lineHeight: 1.22, textShadow, ...fadeUp(msWindow(timing, 250, 500)) }}>&ldquo;{myth}&rdquo;</div></div><Integrated><div style={{ display: "inline-block", background: cssVar("accent"), color: cssVar("accentInk"), ...mono, fontSize: 12, letterSpacing: ".24em", padding: "6px 12px", borderRadius: cssVar("radiusSm"), ...fade(msWindow(timing, 1350, 400)) }}>Fact</div><div style={{ ...display, fontSize: 29, lineHeight: 1.22, marginTop: 14, textShadow, ...fadeUp(msWindow(timing, 1500, 550)) }}>{fact}</div></Integrated></AvatarOverlayShell>;
}

function TextOverlay({ props, timing }: CardComponentProps<AvatarOverlayProps>) {
  const label = prop(props, "heading", "kicker", "label");
  const body = prop(props, "body", "text", "headline") ?? "";
  const supporting = prop(props, "supporting", "detail", "footer");
  return <AvatarOverlayShell template="text-card" props={props} timing={timing}>{label ? <div style={{ position: "absolute", top: 30, left: 30, right: 76, zIndex: 1 }}>{badge(label, timing)}</div> : null}<Integrated><div style={{ ...display, fontSize: 34, lineHeight: 1.24, textShadow, ...fadeUp(msWindow(timing, 300, 550)) }}>{body}</div>{supporting ? <div style={{ fontSize: 18, lineHeight: 1.5, color: photoDim, maxWidth: 280, marginTop: 20, ...fadeUp(msWindow(timing, 750, 500)) }}>{supporting}</div> : null}</Integrated></AvatarOverlayShell>;
}

export const AVATAR_OVERLAY_TEMPLATE_COMPONENTS: Record<AvatarOverlayTemplate, AvatarOverlayTemplateComponent> = {
  "title-card": TitleOverlay,
  "stat-card": StatOverlay,
  "list-reveal": ListOverlay,
  "comparison-split": ComparisonOverlay,
  "quote-card": QuoteOverlay,
  "map-card": MapOverlay,
  "timeline-card": TimelineOverlay,
  "takeaway-card": TakeawayOverlay,
  "pathway-card": PathwayOverlay,
  "persona-card": PersonaOverlay,
  "alert-card": AlertOverlay,
  "breakdown-card": BreakdownOverlay,
  "myth-fact-card": MythFactOverlay,
  "text-card": TextOverlay,
};

/** Renders the avatar-video family without affecting CardRenderer's standard registry. */
export function AvatarOverlayCard({ template, props, timing }: AvatarOverlayCardProps) {
  const Template = AVATAR_OVERLAY_TEMPLATE_COMPONENTS[template as AvatarOverlayTemplate];
  if (!Template) return null;
  return <Template props={props} timing={timing} />;
}
