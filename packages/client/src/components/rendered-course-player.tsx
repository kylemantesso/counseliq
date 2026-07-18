"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PixelRatio,
  Pressable as RNPressable,
  Text as RNText,
  View,
  useWindowDimensions,
} from "react-native";
import { useAction } from "convex/react";
import { Box, Button, ButtonText, Heading, Text } from "@counseliq/ui";
import { api } from "../db/api";
import { RenderedVideoSurface } from "./rendered-video-surface";
import type { Id } from "../../../../convex/_generated/dataModel";

const BASE_SCREEN_WIDTH = 390;
const BASE_SCREEN_HEIGHT = 844;

type Question = {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

type PlayerUnit = {
  unitId: string;
  unitIndex: number;
  unitIndexInModule: number;
  concept: string;
  video:
    | {
        status: "ready";
        durationMs: number;
        width: number;
        height: number;
        fps: number;
        sizeBytes: number;
        variants?: Array<{
          label: string;
          width: number;
          height: number;
          fps: number;
          sizeBytes: number;
        }>;
      }
    | { status: "queued" | "dispatched" | "rendering" | "failed" | "cancelled" | "missing" };
  hookQuestion: Question | null;
  retrieveQuestions: Question[];
  anchor: { template: string; props: Record<string, unknown> } | null;
};

type PlayerModule = {
  moduleId: string;
  moduleIndex: number;
  title: string;
  units: PlayerUnit[];
};

export type RenderedCourseData = {
  course: {
    courseId: Id<"courses">;
    courseVersionId: Id<"courseVersions">;
    title: string;
    level: number;
    version: number;
    publishedAt: number;
    brandRef: string | null;
  };
  institution: { id: Id<"institutions">; name: string; brandTokens: unknown };
  render: { status: "ready" | "processing" | "unavailable"; totalUnits: number; readyUnits: number };
  modules: PlayerModule[];
};

type LearnerCardTheme = {
  bg: string;
  ink: string;
  dim: string;
  accent: string;
  accentInk: string;
  secondary: string;
  rule: string;
  chip: string;
  fontDisplay: string;
  fontText: string;
  fontMono: string;
  titleCase: "none" | "uppercase";
  tracking: string;
  displayWeight: "500" | "600" | "700" | "800";
  radius: number;
  frame: string;
};

type Phase = "hook" | "video" | "retrieve" | "anchor" | "finished";

type VideoUrl = {
  unitId: string;
  url: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  variants?: VideoVariantUrl[];
};

type VideoVariantUrl = {
  label: string;
  url: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  sizeBytes: number;
};

function flattenModules(modules: PlayerModule[]) {
  return modules.flatMap((module) =>
    module.units.map((unit) => ({ module, unit }))
  );
}

function nextPhaseForUnit(unit: PlayerUnit): Phase {
  if (unit.hookQuestion) return "hook";
  if (unit.video.status === "ready") return "video";
  if (unit.retrieveQuestions.length > 0) return "retrieve";
  if (unit.anchor) return "anchor";
  return "finished";
}

function anchorText(anchor: PlayerUnit["anchor"]) {
  const props = anchor?.props ?? {};
  const direct = props.text ?? props.body ?? props.message ?? props.heading ?? props.title;
  if (typeof direct === "string" && direct.trim()) return direct;
  return "Lock in the key takeaway before moving on.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readColor(value: unknown) {
  return typeof value === "string" && value.trim().startsWith("#")
    ? value.trim()
    : null;
}

function readText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function fontStack(value: unknown, fallback: string) {
  const text = readText(value);
  if (!text) return fallback;
  return text.includes(",") ? `${text}, ${fallback}` : `'${text}', ${fallback}`;
}

function isLatrobe(value: unknown) {
  return typeof value === "string" && value.toLowerCase().replace(/[^a-z0-9]/g, "").includes("latrobe");
}

function isCdu(value: unknown) {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.includes("charlesdarwin") || normalized.includes("cdu");
}

function themeFromCourse(data: RenderedCourseData): LearnerCardTheme {
  const tokens: Record<string, unknown> = isRecord(data.institution.brandTokens)
    ? { ...data.institution.brandTokens, brandRef: data.course.brandRef }
    : { brandRef: data.course.brandRef };
  const latrobe = isLatrobe(tokens.brandRef) || isLatrobe(tokens.theme) || isLatrobe(tokens.preset);
  const cdu =
    isCdu(data.institution.name) ||
    isCdu(tokens.brandRef) ||
    isCdu(tokens.theme) ||
    isCdu(tokens.preset);
  const base: LearnerCardTheme = latrobe
    ? {
        bg: "#FCFBF9",
        ink: "#141414",
        dim: "rgba(20,20,20,.62)",
        accent: "#E2231A",
        accentInk: "#FFFFFF",
        secondary: "#141414",
        rule: "rgba(20,20,20,.16)",
        chip: "rgba(20,20,20,.05)",
        fontDisplay: "'Barlow Condensed', 'Arial Narrow', sans-serif",
        fontText: "'Barlow', 'Segoe UI', sans-serif",
        fontMono: "'IBM Plex Mono', monospace",
        titleCase: "uppercase",
        tracking: ".015em",
        displayWeight: "700",
        radius: 4,
        frame: "#FCFBF9",
      }
    : cdu
      ? {
          bg: "#FFFFFF",
          ink: "#111827",
          dim: "rgba(17,24,39,.62)",
          accent: "#17113D",
          accentInk: "#FFFFFF",
          secondary: "#37B4A7",
          rule: "rgba(17,24,39,.16)",
          chip: "rgba(17,24,39,.05)",
          fontDisplay: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontText: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontMono: "'IBM Plex Mono', monospace",
          titleCase: "none",
          tracking: "0",
          displayWeight: "700",
          radius: 28,
          frame: "#07111B",
        }
    : {
        bg: "#FCFBF9",
        ink: "#141414",
        dim: "rgba(20,20,20,.62)",
        accent: "#C9A227",
        accentInk: "#141414",
        secondary: "#17113D",
        rule: "rgba(20,20,20,.16)",
        chip: "rgba(20,20,20,.05)",
        fontDisplay: "'Source Serif 4', Georgia, serif",
        fontText: "'Source Sans 3', 'Segoe UI', sans-serif",
        fontMono: "'IBM Plex Mono', monospace",
        titleCase: "none",
        tracking: "-0.012em",
        displayWeight: "600",
        radius: 4,
        frame: "#FCFBF9",
      };

  if (isRecord(tokens)) {
    const colors = Array.isArray(tokens.colors) ? tokens.colors : [];
    base.accent = readColor(tokens.primaryColor) ?? readColor(colors[0]) ?? base.accent;
    base.secondary = readColor(tokens.secondaryColor) ?? readColor(colors[1]) ?? base.secondary;
    base.bg = readColor(tokens.backgroundColor) ?? base.bg;
    base.ink = readColor(tokens.textColor) ?? base.ink;
    if (!cdu) {
      base.titleCase = readText(tokens.titleCase)?.toLowerCase() === "uppercase" ? "uppercase" : "none";
      const fonts = Array.isArray(tokens.fonts) ? tokens.fonts : [];
      base.fontDisplay = fontStack(
        tokens.titleFontFamily ?? tokens.displayFontFamily ?? tokens.fontFamily ?? fonts[0],
        base.fontDisplay
      );
      base.fontText = fontStack(
        tokens.bodyFontFamily ?? tokens.textFontFamily ?? fonts[1],
        base.fontText
      );
    }
  }

  return base;
}

function questionFontFamily(theme: LearnerCardTheme) {
  return theme.titleCase === "uppercase" ? theme.fontDisplay : theme.fontText;
}

function questionFontWeight(theme: LearnerCardTheme): LearnerCardTheme["displayWeight"] {
  return theme.titleCase === "uppercase" ? theme.displayWeight : "700";
}

function promptSize(prompt: string) {
  if (prompt.length > 330) return 20;
  if (prompt.length > 280) return 22;
  if (prompt.length > 230) return 24;
  if (prompt.length > 180) return 28;
  if (prompt.length > 140) return 32;
  return 36;
}

function useScreenScale() {
  const { width, height } = useWindowDimensions();
  return Math.max(
    0.88,
    Math.min(1, Math.min(width / BASE_SCREEN_WIDTH, height / BASE_SCREEN_HEIGHT))
  );
}

function selectFullscreenVariant(video: VideoUrl | undefined, width: number, height: number) {
  if (!video) return null;
  const fallback: VideoVariantUrl = {
    label: `${video.width}x${video.height}`,
    url: video.url,
    durationMs: video.durationMs,
    width: video.width,
    height: video.height,
    fps: video.fps,
    sizeBytes: 0,
  };
  const variants = video.variants && video.variants.length > 0 ? video.variants : [fallback];
  const pixelRatio = PixelRatio.get();
  const targetWidth = Math.max(1, width * pixelRatio);
  const targetHeight = Math.max(1, height * pixelRatio);
  const targetAspect = targetWidth / targetHeight;

  return [...variants].sort((a, b) => {
    const aAspectPenalty = Math.abs(Math.log((a.width / a.height) / targetAspect));
    const bAspectPenalty = Math.abs(Math.log((b.width / b.height) / targetAspect));
    if (Math.abs(aAspectPenalty - bAspectPenalty) > 0.0001) {
      return aAspectPenalty - bAspectPenalty;
    }

    const aUnderfill = Math.max(0, targetWidth - a.width) + Math.max(0, targetHeight - a.height);
    const bUnderfill = Math.max(0, targetWidth - b.width) + Math.max(0, targetHeight - b.height);
    if (Math.abs(aUnderfill - bUnderfill) > 1) return aUnderfill - bUnderfill;

    return a.width * a.height - b.width * b.height;
  })[0];
}

function estimatePromptLayout(prompt: string, availableWidth: number, availableHeight: number, maxSize: number) {
  for (let size = maxSize; size >= 16; size -= 1) {
    const charsPerLine = Math.max(14, Math.floor(availableWidth / (size * 0.52)));
    const lines = Math.max(1, Math.ceil(prompt.length / charsPerLine));
    const lineHeight = size * 1.12;
    const height = lines * lineHeight;
    if (height <= availableHeight) {
      return { size, lineHeight, height };
    }
  }
  const charsPerLine = Math.max(14, Math.floor(availableWidth / (16 * 0.52)));
  const lines = Math.max(1, Math.ceil(prompt.length / charsPerLine));
  return { size: 16, lineHeight: 18, height: lines * 18 };
}

export function RenderedCoursePlayer({ data }: { data: RenderedCourseData }) {
  const flat = useMemo(() => flattenModules(data.modules), [data.modules]);
  const theme = useMemo(() => themeFromCourse(data), [data]);
  const getVideoUrls = useAction(api.publicCourseMedia.getUnitVideoUrls);
  const [activeIndex, setActiveIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>(() =>
    flat[0] ? nextPhaseForUnit(flat[0].unit) : "finished"
  );
  const [urls, setUrls] = useState<Record<string, VideoUrl>>({});
  const [expiresAt, setExpiresAt] = useState(0);
  const current = flat[activeIndex] ?? null;
  const activeUrl = current ? urls[current.unit.unitId] : undefined;

  useEffect(() => {
    const item = flat[activeIndex];
    if (!item) return;
    setPhase(nextPhaseForUnit(item.unit));
  }, [activeIndex, flat]);

  useEffect(() => {
    const wanted = [flat[activeIndex], flat[activeIndex + 1]]
      .map((item) => item?.unit)
      .filter((unit): unit is PlayerUnit => Boolean(unit) && unit.video.status === "ready");
    const now = Date.now();
    const missing = wanted.filter((unit) => !urls[unit.unitId] || expiresAt - now < 60_000);
    if (missing.length === 0) return;

    let cancelled = false;
    void getVideoUrls({
      courseVersionId: data.course.courseVersionId,
      unitIds: missing.map((unit) => unit.unitId),
    }).then((result) => {
      if (cancelled) return;
      setExpiresAt(result.expiresAt);
      setUrls((existing) => {
        const next = { ...existing };
        for (const unit of result.units) next[unit.unitId] = unit;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeIndex, data.course.courseVersionId, expiresAt, flat, getVideoUrls, urls]);

  const advance = () => {
    const unit = current?.unit;
    if (!unit) return;
    if (phase === "hook") {
      setPhase(unit.video.status === "ready" ? "video" : unit.retrieveQuestions.length > 0 ? "retrieve" : unit.anchor ? "anchor" : "finished");
    } else if (phase === "video") {
      setPhase(unit.retrieveQuestions.length > 0 ? "retrieve" : unit.anchor ? "anchor" : "finished");
    } else if (phase === "retrieve") {
      setPhase(unit.anchor ? "anchor" : "finished");
    } else if (phase === "anchor" || phase === "finished") {
      if (activeIndex + 1 < flat.length) setActiveIndex(activeIndex + 1);
      else setPhase("finished");
    }
  };

  if (!current) {
    return (
      <Box className="flex-1 items-center justify-center bg-background p-6">
        <Text className="text-center text-muted-foreground">No units are available for this course yet.</Text>
      </Box>
    );
  }

  const unit = current.unit;

  return (
    <Box className="flex-1 bg-background">
      {phase === "hook" && unit.hookQuestion ? (
        <QuestionCard
          theme={theme}
          question={unit.hookQuestion}
          eyebrow="Commit — answer before we teach it"
          continueLabel="Start video"
          variant="primer"
          onContinue={advance}
        />
      ) : null}

      {phase === "video" ? (
        <VideoPanel theme={theme} unit={unit} url={activeUrl} onContinue={advance} />
      ) : null}

      {phase === "retrieve" ? (
        <RetrievePanel theme={theme} questions={unit.retrieveQuestions} onContinue={advance} />
      ) : null}

      {phase === "anchor" ? (
        <AnchorCard
          theme={theme}
          text={anchorText(unit.anchor)}
          continueLabel={activeIndex + 1 < flat.length ? "Next unit" : "Finish course"}
          onContinue={advance}
        />
      ) : null}

      {phase === "finished" ? (
        <ThemedFullScreen theme={theme}>
          <FinishedCardContent
            theme={theme}
            label={activeIndex + 1 < flat.length ? "Unit complete" : "Course complete"}
            title={activeIndex + 1 < flat.length ? "Ready for the next unit?" : "You reached the end of the prototype."}
            buttonLabel={activeIndex + 1 < flat.length ? "Continue" : "Review course"}
            onContinue={advance}
          />
        </ThemedFullScreen>
      ) : null}
    </Box>
  );
}

function FinishedCardContent({
  theme,
  label,
  title,
  buttonLabel,
  onContinue,
}: {
  theme: LearnerCardTheme;
  label: string;
  title: string;
  buttonLabel: string;
  onContinue: () => void;
}) {
  const scale = useScreenScale();
  const s = (value: number) => value * scale;

  return (
    <Box style={{ flex: 1, justifyContent: "center", paddingHorizontal: s(30), backgroundColor: theme.bg }}>
      <Text style={{ fontFamily: theme.fontMono, color: theme.accent, fontSize: s(11), letterSpacing: s(2.4), textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text style={{ marginTop: s(18), fontFamily: theme.fontDisplay, color: theme.ink, fontSize: s(36), lineHeight: s(41), fontWeight: theme.displayWeight, letterSpacing: s(Number.parseFloat(theme.tracking) || 0), textTransform: theme.titleCase }}>
        {title}
      </Text>
      <Button className="rounded-full" style={{ marginTop: s(32), minHeight: s(46), alignSelf: "flex-start", paddingHorizontal: s(28), backgroundColor: theme.accent }} onPress={onContinue}>
        <ButtonText style={{ color: theme.accentInk }}>{buttonLabel}</ButtonText>
      </Button>
    </Box>
  );
}

function VideoPanel({ theme, unit, url, onContinue }: { theme: LearnerCardTheme; unit: PlayerUnit; url?: VideoUrl; onContinue: () => void }) {
  const { width, height } = useWindowDimensions();
  const selected = selectFullscreenVariant(url, width, height);

  if (unit.video.status !== "ready") {
    return (
      <ThemedFullScreen theme={theme}>
        <Box style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 28, backgroundColor: theme.bg }}>
        <Heading size="xl" className="text-center">Video is not ready yet.</Heading>
        <Text className="text-center text-muted-foreground">This rendered unit is currently {unit.video.status}.</Text>
        <Button variant="outline" className="rounded-full px-8" onPress={onContinue}>
          <ButtonText>Skip for now</ButtonText>
        </Button>
        </Box>
      </ThemedFullScreen>
    );
  }

  return (
    <Box className="flex-1 bg-black">
      {selected ? (
        <RenderedVideoSurface url={selected.url} contentFit="cover" onEnd={onContinue} />
      ) : (
        <Box className="flex-1 items-center justify-center bg-black">
          <Text className="text-center text-background">Preparing video...</Text>
        </Box>
      )}
    </Box>
  );
}

function RetrievePanel({ theme, questions, onContinue }: { theme: LearnerCardTheme; questions: Question[]; onContinue: () => void }) {
  const [index, setIndex] = useState(0);
  const question = questions[index];

  if (!question) {
    return (
      <ThemedFullScreen theme={theme}>
        <Box style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.bg }}>
          <Button className="rounded-full px-8" onPress={onContinue}>
            <ButtonText>Continue</ButtonText>
          </Button>
        </Box>
      </ThemedFullScreen>
    );
  }

  return (
      <QuestionCard
        theme={theme}
        question={question}
      eyebrow={`Retrieve ${index + 1}/${questions.length}`}
      continueLabel={index + 1 < questions.length ? "Next question" : "Continue"}
      onContinue={() => {
        if (index + 1 < questions.length) setIndex(index + 1);
        else onContinue();
      }}
    />
  );
}

function ThemedFullScreen({ theme, children }: { theme: LearnerCardTheme; children: ReactNode }) {
  return (
    <Box className="flex-1" style={{ backgroundColor: theme.bg }}>
      {children}
    </Box>
  );
}

function AnchorCard({ theme, text, continueLabel, onContinue }: { theme: LearnerCardTheme; text: string; continueLabel: string; onContinue: () => void }) {
  return (
    <ThemedFullScreen theme={theme}>
      <AnchorCardContent theme={theme} text={text} continueLabel={continueLabel} onContinue={onContinue} />
    </ThemedFullScreen>
  );
}

function AnchorCardContent({ theme, text, continueLabel, onContinue }: { theme: LearnerCardTheme; text: string; continueLabel: string; onContinue: () => void }) {
  const { width, height } = useWindowDimensions();
  const scale = Math.max(0.86, Math.min(1.2, Math.min(width / 390, height / 844)));
  const s = (value: number) => Math.round(value * scale);
  const textSize = text.length > 190 ? 28 : text.length > 140 ? 32 : text.length > 90 ? 36 : 42;

  return (
      <View style={{ flex: 1, position: "relative", backgroundColor: theme.bg }}>
        <RNText style={{
          position: "absolute",
          top: s(30),
          left: s(42),
          right: s(42),
          fontFamily: theme.fontMono,
          color: theme.accent,
          fontSize: s(11),
          letterSpacing: s(2.4),
          textTransform: "uppercase",
        }}>
          Anchor
        </RNText>
        <View style={{
          position: "absolute",
          top: s(88),
          left: s(42),
          width: s(44),
          height: Math.max(2, s(3)),
          backgroundColor: theme.accent,
        }} />
        <RNText
          numberOfLines={9}
          style={{
            position: "absolute",
            top: s(135),
            left: s(42),
            right: s(36),
            fontFamily: theme.fontDisplay,
            color: theme.ink,
            fontSize: s(textSize),
            lineHeight: s(textSize * 1.08),
            fontWeight: theme.displayWeight,
            letterSpacing: s(Number.parseFloat(theme.tracking) || 0),
            textTransform: theme.titleCase,
          }}
        >
          {text}
        </RNText>
        <View style={{ position: "absolute", left: s(42), right: s(42), bottom: s(36) }}>
          <Button className="rounded-full" style={{ alignSelf: "flex-start", paddingHorizontal: s(28), minHeight: s(46), backgroundColor: theme.accent }} onPress={onContinue}>
            <ButtonText style={{ color: theme.accentInk }}>{continueLabel}</ButtonText>
          </Button>
        </View>
      </View>
  );
}

function QuestionCard({
  theme,
  question,
  eyebrow,
  continueLabel,
  variant = "default",
  onContinue,
}: {
  theme: LearnerCardTheme;
  question: Question;
  eyebrow: string;
  continueLabel: string;
  variant?: "default" | "primer";
  onContinue: () => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const correct = picked === question.correctIndex;

  useEffect(() => {
    setPicked(null);
  }, [question.id]);

  return (
    <ThemedFullScreen theme={theme}>
      <QuestionCardContent
        theme={theme}
        question={question}
        eyebrow={eyebrow}
        continueLabel={continueLabel}
        variant={variant}
        onContinue={onContinue}
        picked={picked}
        setPicked={setPicked}
        answered={answered}
        correct={correct}
      />
    </ThemedFullScreen>
  );
}

function QuestionCardContent({
  theme,
  question,
  eyebrow,
  continueLabel,
  variant,
  onContinue,
  picked,
  setPicked,
  answered,
  correct,
}: {
  theme: LearnerCardTheme;
  question: Question;
  eyebrow: string;
  continueLabel: string;
  variant: "default" | "primer";
  onContinue: () => void;
  picked: number | null;
  setPicked: (index: number) => void;
  answered: boolean;
  correct: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const cardWidth = width;
  const cardHeight = height;
  const baseScale = Math.max(0.82, Math.min(1, Math.min(cardWidth / 390, cardHeight / 844)));
  const horizontal = Math.round(28 * baseScale);
  const availableWidth = Math.max(260, cardWidth - horizontal * 2);
  const optionCount = Math.max(2, question.options.length);
  const fixedQuestionSpace = 46 + 18 + 28 + 30 + optionCount * 54 + (optionCount - 1) * 10 + 150 + 28;
  const rawPromptBudget = Math.max(150, cardHeight / baseScale - fixedQuestionSpace);
  const promptFit = estimatePromptLayout(
    question.prompt,
    availableWidth / baseScale,
    rawPromptBudget,
    Math.min(promptSize(question.prompt), 34)
  );
  const rawTotal = fixedQuestionSpace + promptFit.height;
  const scale = Math.max(0.62, Math.min(baseScale, cardHeight / rawTotal));
  const s = (value: number) => Math.round(value * scale);
  const font = (value: number) => Math.max(8, value * scale);
  const cardPadX = s(28);
  const eyebrowTop = s(44);
  const eyebrowHeight = s(18);
  const promptTop = eyebrowTop + eyebrowHeight + s(28);
  const promptFontSize = font(promptFit.size);
  const promptLineHeight = font(promptFit.lineHeight);
  const optionHeight = s(54);
  const optionGap = s(10);
  const optionTop = promptTop + font(promptFit.height) + s(30);
  const optionsHeight = optionCount * optionHeight + (optionCount - 1) * optionGap;
  const buttonHeight = s(48);
  const buttonTop = cardHeight - buttonHeight - s(24);
  const feedbackTop = buttonTop - s(114);
  const optionFontSize = font(15.5);
  const optionLineHeight = font(20);
  const maxOptionLines = 2;
  const explanationLines = 3;
  const primer = variant === "primer";
  const backgroundColor = primer ? theme.accent : theme.bg;
  const promptColor = primer ? theme.accentInk : theme.ink;
  const secondaryColor = primer ? theme.accentInk : theme.dim;
  const eyebrowColor = primer ? theme.accentInk : theme.accent;
  const optionBackgroundColor = primer ? theme.bg : "transparent";
  const optionBorderColor = primer ? theme.bg : theme.rule;
  const optionTextColor = theme.ink;
  const optionSecondaryColor = theme.dim;
  const selectedBorderColor = theme.secondary;
  const correctMarkColor = theme.accent;
  const selectedBackgroundColor = primer ? theme.bg : theme.chip;
  const feedbackAccent = primer ? theme.accentInk : theme.accent;
  const buttonBackground = primer ? theme.bg : theme.accent;
  const buttonTextColor = primer ? theme.ink : theme.accentInk;
  const optionBorderWidth = Math.max(1, s(1.5));

  return (
      <View style={{ flex: 1, position: "relative", backgroundColor }}>
        <RNText style={{
          position: "absolute",
          top: eyebrowTop,
          left: cardPadX,
          right: cardPadX,
          fontFamily: theme.fontMono,
          color: eyebrowColor,
          fontSize: font(11),
          letterSpacing: s(2.4),
          textTransform: "uppercase",
        }}>
          {eyebrow}
        </RNText>
        <RNText
          style={{
            position: "absolute",
            top: promptTop,
            left: cardPadX,
            right: cardPadX,
            fontFamily: questionFontFamily(theme),
            color: promptColor,
            fontSize: promptFontSize,
            lineHeight: promptLineHeight,
            fontWeight: questionFontWeight(theme),
            letterSpacing: (Number.parseFloat(theme.tracking) || 0) * scale,
            textTransform: theme.titleCase,
          }}
        >
          {question.prompt}
        </RNText>
        <View style={{
          position: "absolute",
          top: optionTop,
          left: cardPadX,
          right: cardPadX,
          gap: optionGap,
        }}>
          {question.options.map((option, index) => {
            const isCorrect = answered && index === question.correctIndex;
            const isWrong = answered && picked === index && index !== question.correctIndex;
            const dimmed = answered && !isCorrect && !isWrong;
            return (
              <RNPressable key={`${question.id}-${index}`} disabled={answered} onPress={() => setPicked(index)}>
                <View
                  style={{
                    height: optionHeight,
                    position: "relative",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: s(10),
                    borderWidth: optionBorderWidth,
                    borderColor: isCorrect ? selectedBorderColor : optionBorderColor,
                    borderRadius: s(5),
                    backgroundColor: isCorrect ? selectedBackgroundColor : optionBackgroundColor,
                    paddingHorizontal: s(13),
                    paddingVertical: s(9),
                    opacity: dimmed ? 0.45 : 1,
                    overflow: "hidden",
                  }}
                >
                  <RNText style={{ fontFamily: theme.fontMono, color: isCorrect ? correctMarkColor : isWrong ? correctMarkColor : optionSecondaryColor, fontSize: font(15), fontWeight: "800" }}>
                    {isCorrect ? "✓" : isWrong ? "×" : String.fromCharCode(65 + index)}
                  </RNText>
                  <RNText numberOfLines={maxOptionLines} style={{ flex: 1, fontFamily: theme.fontText, color: optionTextColor, fontSize: optionFontSize, lineHeight: optionLineHeight }}>
                    {option}
                  </RNText>
                </View>
              </RNPressable>
            );
          })}
        </View>
        {answered ? (
          <View style={{
            position: "absolute",
            top: feedbackTop,
            left: cardPadX,
            right: cardPadX,
            paddingLeft: s(12),
            borderLeftWidth: Math.max(2, s(3)),
            borderLeftColor: feedbackAccent,
          }}>
            <RNText style={{ fontFamily: theme.fontMono, color: correct ? feedbackAccent : secondaryColor, fontSize: font(9.5), letterSpacing: s(1.4), textTransform: "uppercase" }}>
              {correct ? "Correct" : "Not quite"}
            </RNText>
            <RNText numberOfLines={explanationLines} style={{ marginTop: s(5), fontFamily: theme.fontText, color: secondaryColor, fontSize: font(13.5), lineHeight: font(19) }}>
              {question.explanation}
            </RNText>
          </View>
        ) : null}
        {answered ? (
          <Button className="rounded-full" style={{ position: "absolute", top: buttonTop, left: cardPadX, right: cardPadX, minHeight: buttonHeight, backgroundColor: buttonBackground }} onPress={onContinue}>
            <ButtonText style={{ color: buttonTextColor }}>{continueLabel}</ButtonText>
          </Button>
        ) : null}
      </View>
  );
}
