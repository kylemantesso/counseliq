"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import {
  Box,
  Button,
  ButtonText,
  Input,
  InputField,
  ScrollView,
  StatusBadge,
  SurfaceCard,
  Text,
} from "@counseliq/ui";
import { CARD_PROP_FIXTURES } from "@counseliq/course-schema";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AdminGuard } from "../components/admin-guard";
import { CardStaticPreview } from "../components/card-static-preview.web";
import { GoogleBrandFontLoader } from "../components/theme/google-brand-font-loader.web";
import { useSelectedInstitution } from "../components/admin/use-selected-institution";
import { AdminWorkspaceFrame } from "../components/admin-workspace-frame";
import { api } from "../db/api";
import { getUserFacingErrorMessage } from "../errors/get-user-facing-message";
import {
  GOOGLE_BRAND_FONT_OPTIONS,
  normalizeFontFamily,
} from "../theme/google-brand-fonts";

const CUSTOM_FONT_OPTION = "__custom__";
const HEADING_CASE_OPTIONS = [
  { value: "none", label: "Sentence case" },
  { value: "uppercase", label: "UPPERCASE" },
] as const;

export function AdminInstitutionsScreen() {
  return (
    <AdminGuard>
      <AdminInstitutionsContent />
    </AdminGuard>
  );
}

function AdminInstitutionsContent() {
  const { institutions, selectedInstitutionId, setInstitution } = useSelectedInstitution();
  const createInstitution = useMutation(api.pipeline.assetsCatalogue.adminCreateInstitution);
  const updateInstitution = useMutation(api.pipeline.assetsCatalogue.adminUpdateInstitution);
  const extractThemeFromWebsite = useAction(
    api.pipeline.institutionTheme.adminExtractInstitutionThemeFromWebsite
  );

  const [createName, setCreateName] = useState("");
  const [detailsInstitutionId, setDetailsInstitutionId] = useState<
    Id<"institutions"> | null
  >(null);
  const [detailsName, setDetailsName] = useState("");
  const [detailsMarket, setDetailsMarket] = useState("AU");
  const [detailsWebsiteUrl, setDetailsWebsiteUrl] = useState("");
  const [detailsPrimaryColor, setDetailsPrimaryColor] = useState("");
  const [detailsSecondaryColor, setDetailsSecondaryColor] = useState("");
  const [detailsBackgroundColor, setDetailsBackgroundColor] = useState("");
  const [detailsLogoUrl, setDetailsLogoUrl] = useState("");
  const [detailsFontFamily, setDetailsFontFamily] = useState("");
  const [detailsTitleCase, setDetailsTitleCase] = useState<"none" | "uppercase">(
    "none"
  );
  const [detailsPlaceholder, setDetailsPlaceholder] = useState(false);
  const [extractFeedback, setExtractFeedback] = useState<{
    tone: "info" | "warning" | "success";
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(
    () => [...(institutions ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    [institutions]
  );

  const detailsInstitution =
    detailsInstitutionId === null
      ? null
      : rows.find((row) => row._id === detailsInstitutionId) ?? null;
  const previewPrimaryColor = isHexColor(detailsPrimaryColor.trim())
    ? detailsPrimaryColor.trim()
    : "#1A365D";
  const previewSecondaryColor = isHexColor(detailsSecondaryColor.trim())
    ? detailsSecondaryColor.trim()
    : "#C53030";
  const previewBackgroundColor = isHexColor(detailsBackgroundColor.trim())
    ? detailsBackgroundColor.trim()
    : "#0E1B2C";
  const previewFontFamily = detailsFontFamily.trim() || "system-ui";
  const previewInstitutionName = detailsName.trim() || "Institution";
  const previewBrandTokens = useMemo(
    () => ({
      placeholder: detailsPlaceholder,
      primaryColor: previewPrimaryColor,
      secondaryColor: previewSecondaryColor,
      backgroundColor: previewBackgroundColor,
      ...(detailsLogoUrl.trim() ? { logoUrl: detailsLogoUrl.trim() } : {}),
      fontFamily: previewFontFamily,
      titleCase: detailsTitleCase,
    }),
    [
      detailsPlaceholder,
      previewPrimaryColor,
      previewSecondaryColor,
      previewBackgroundColor,
      detailsLogoUrl,
      previewFontFamily,
      detailsTitleCase,
    ]
  );
  const titleCardPreviewProps = useMemo(
    () => ({
      ...CARD_PROP_FIXTURES["title-card"],
      title: `Why ${previewInstitutionName} for Health`,
      courseLabel: `${previewInstitutionName} Health Portfolio`,
    }),
    [previewInstitutionName]
  );
  const secondaryColorPreviewProps = useMemo(
    () => ({
      ...CARD_PROP_FIXTURES["persona-card"],
      name: `${previewInstitutionName} Counsellor Persona`,
      location: detailsMarket.trim() || "AU",
      chips: ["Secondary token", "Chip + rules", "Preview"],
      footerPrompt: `How should ${previewInstitutionName} be positioned?`,
    }),
    [previewInstitutionName, detailsMarket]
  );
  const normalizedFontFamily = normalizeFontFamily(detailsFontFamily);
  const fontSelectValue =
    normalizedFontFamily &&
    GOOGLE_BRAND_FONT_OPTIONS.includes(
      normalizedFontFamily as (typeof GOOGLE_BRAND_FONT_OPTIONS)[number]
    )
      ? normalizedFontFamily
      : CUSTOM_FONT_OPTION;

  useEffect(() => {
    if (!rows.length) {
      setDetailsInstitutionId(null);
      return;
    }
    if (detailsInstitutionId && rows.some((row) => row._id === detailsInstitutionId)) {
      return;
    }
    const nextId = selectedInstitutionId ?? rows[0]._id;
    hydrateDetails(nextId);
  }, [rows, detailsInstitutionId, selectedInstitutionId]);

  function hydrateDetails(institutionId: Id<"institutions">) {
    const institution = rows.find((row) => row._id === institutionId);
    if (!institution) return;
    const tokens = toRecord(institution.brandTokens);
    setDetailsInstitutionId(institution._id);
    setDetailsName(institution.name);
    setDetailsMarket(institution.market || "AU");
    setDetailsWebsiteUrl(typeof institution.websiteUrl === "string" ? institution.websiteUrl : "");
    setDetailsPrimaryColor(readToken(tokens, "primaryColor"));
    setDetailsSecondaryColor(readToken(tokens, "secondaryColor"));
    setDetailsBackgroundColor(readToken(tokens, "backgroundColor"));
    setDetailsLogoUrl(readToken(tokens, "logoUrl"));
    setDetailsFontFamily(readToken(tokens, "fontFamily"));
    setDetailsTitleCase(parseTitleCaseToken(tokens.titleCase));
    setDetailsPlaceholder(tokens.placeholder === true);
    setExtractFeedback(null);
  }

  async function handleCreate() {
    const nextName = createName.trim();
    if (!nextName) {
      setError("Enter an institution name.");
      return;
    }

    setBusy("create");
    setError(null);
    setNotice(null);
    try {
      const result = await createInstitution({
        name: nextName,
        market: "AU",
      });
      setCreateName("");
      setInstitution(result.institutionId);
      hydrateDetails(result.institutionId);
    } catch (createError) {
      setError(getUserFacingErrorMessage(createError, "Could not create institution."));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveDetails() {
    if (!detailsInstitutionId) return;
    const nextName = detailsName.trim();
    if (!nextName) {
      setError("Enter an institution name.");
      return;
    }
    if (
      detailsPrimaryColor.trim() &&
      !isHexColor(detailsPrimaryColor.trim())
    ) {
      setError("Primary color must be a valid hex value like #1A365D.");
      return;
    }
    if (
      detailsSecondaryColor.trim() &&
      !isHexColor(detailsSecondaryColor.trim())
    ) {
      setError("Secondary color must be a valid hex value like #C53030.");
      return;
    }
    if (
      detailsBackgroundColor.trim() &&
      !isHexColor(detailsBackgroundColor.trim())
    ) {
      setError("Background color must be a valid hex value like #0E1B2C.");
      return;
    }
    if (detailsLogoUrl.trim() && !isValidHttpUrl(detailsLogoUrl.trim())) {
      setError("Logo URL must be a valid http(s) URL.");
      return;
    }

    setBusy(`save:${detailsInstitutionId}`);
    setError(null);
    setNotice(null);
    try {
      await updateInstitution({
        institutionId: detailsInstitutionId,
        name: nextName,
        market: detailsMarket.trim() || "AU",
        websiteUrl: detailsWebsiteUrl.trim() || null,
        brandTokens: {
          placeholder: detailsPlaceholder,
          ...(detailsPrimaryColor.trim()
            ? { primaryColor: detailsPrimaryColor.trim() }
            : {}),
          ...(detailsSecondaryColor.trim()
            ? { secondaryColor: detailsSecondaryColor.trim() }
            : {}),
          ...(detailsBackgroundColor.trim()
            ? { backgroundColor: detailsBackgroundColor.trim() }
            : {}),
          ...(detailsLogoUrl.trim() ? { logoUrl: detailsLogoUrl.trim() } : {}),
          ...(detailsFontFamily.trim()
            ? { fontFamily: detailsFontFamily.trim() }
            : {}),
          titleCase: detailsTitleCase,
        },
      });
      setInstitution(detailsInstitutionId);
      setNotice("Institution details saved.");
    } catch (updateError) {
      setError(
        getUserFacingErrorMessage(updateError, "Could not save institution details.")
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleExtractTheme() {
    if (!detailsInstitutionId) return;
    if (!detailsWebsiteUrl.trim()) {
      setError("Enter a website URL first.");
      return;
    }

    setBusy(`extract:${detailsInstitutionId}`);
    setError(null);
    setNotice(null);
    setExtractFeedback({
      tone: "info",
      message: "Extracting theme from website...",
    });
    try {
      const extracted = await extractThemeFromWebsite({
        institutionId: detailsInstitutionId,
        websiteUrl: detailsWebsiteUrl,
      });
      setDetailsWebsiteUrl(extracted.websiteUrl);
      let applied = 0;
      if (extracted.primaryColor) setDetailsPrimaryColor(extracted.primaryColor);
      if (extracted.primaryColor) applied += 1;
      if (extracted.secondaryColor) setDetailsSecondaryColor(extracted.secondaryColor);
      if (extracted.secondaryColor) applied += 1;
      if (extracted.backgroundColor) setDetailsBackgroundColor(extracted.backgroundColor);
      if (extracted.backgroundColor) applied += 1;
      if (extracted.logoUrl) setDetailsLogoUrl(extracted.logoUrl);
      if (extracted.logoUrl) applied += 1;
      if (extracted.fontFamily) setDetailsFontFamily(extracted.fontFamily);
      if (extracted.fontFamily) applied += 1;
      if (applied > 0) {
        setDetailsPlaceholder(false);
      }
      const message = extracted.warning
        ? `${extracted.warning} ${
            applied > 0
              ? `Applied ${applied} extracted theme value${applied === 1 ? "" : "s"}.`
              : "No values were auto-applied."
          }`
        : `Website theme extracted from homepage + same-origin CSS (${extracted.cssSourceCount} source${
            extracted.cssSourceCount === 1 ? "" : "s"
          })${extracted.logoUrl ? " with a logo candidate" : ""}. Save institution details to apply.`;
      setExtractFeedback({
        tone: extracted.warning ? "warning" : "success",
        message,
      });
      setNotice(message);
    } catch (extractError) {
      const message = getUserFacingErrorMessage(
        extractError,
        "Could not extract a website theme. Check the URL, and ensure Convex is running the latest functions (`npm run convex:dev`)."
      );
      setError(message);
      setExtractFeedback({ tone: "warning", message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminWorkspaceFrame
      activeNav="institutions"
      title="Institutions"
      description="Click an institution to edit identity, market, and theme tokens used in course output."
    >
      <GoogleBrandFontLoader fontFamily={previewFontFamily} />
      <ScrollView className="flex-1 w-full">
        <Box className="gap-4 pb-4">
          <SurfaceCard
            title="Create institution"
            subtitle="New institutions are immediately available in source docs, assets, and course generation."
          >
            <Box className="flex-row flex-wrap items-center gap-2">
              <Box className="min-w-[260px] flex-1">
                <Input>
                  <InputField
                    value={createName}
                    onChangeText={setCreateName}
                    placeholder="Institution name"
                    autoCapitalize="words"
                  />
                </Input>
              </Box>
              <Button isDisabled={busy === "create"} onPress={handleCreate}>
                <ButtonText>{busy === "create" ? "Creating..." : "Create institution"}</ButtonText>
              </Button>
            </Box>
            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
          </SurfaceCard>

          {notice ? <Text className="text-sm text-[#1f7a45]">{notice}</Text> : null}

          <SurfaceCard title="Manage institutions" subtitle="Select one to edit details.">
            {!institutions ? (
              <Text className="text-sm text-muted-foreground">Loading institutions...</Text>
            ) : rows.length === 0 ? (
              <Text className="text-sm text-muted-foreground">No institutions yet.</Text>
            ) : (
              <Box>
                {rows.map((institution) => {
                  const isSelected = institution._id === selectedInstitutionId;
                  const isEditing = institution._id === detailsInstitutionId;
                  return (
                    <Box
                      key={institution._id}
                      className="border-t border-border py-3 first:border-t-0 gap-2"
                    >
                      <Box className="flex-row items-center justify-between gap-2 flex-wrap">
                        <Box className="gap-1">
                          <Text className="font-semibold text-foreground">{institution.name}</Text>
                          <Text className="text-xs text-muted-foreground">
                            {institution.market} market · created {shortDate(institution._creationTime)}
                          </Text>
                        </Box>
                        <Box className="flex-row items-center gap-2">
                          {isSelected ? (
                            <StatusBadge label="Selected" tone="success" />
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onPress={() => setInstitution(institution._id)}
                            >
                              <ButtonText>Use in workspace</ButtonText>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant={isEditing ? "default" : "outline"}
                            onPress={() => {
                              setInstitution(institution._id);
                              hydrateDetails(institution._id);
                              setError(null);
                            }}
                          >
                            <ButtonText>{isEditing ? "Editing" : "Edit details"}</ButtonText>
                          </Button>
                        </Box>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </SurfaceCard>

          {detailsInstitution ? (
            <SurfaceCard
              title={`Edit institution details: ${detailsInstitution.name}`}
              subtitle="Theme tokens here drive course styling in preview and publish."
            >
              <Box className="gap-3">
                <Box className="flex-row flex-wrap gap-2">
                  <Box className="min-w-[280px] flex-1">
                    <Text className="text-xs text-muted-foreground mb-1">Institution name</Text>
                    <Input>
                      <InputField
                        value={detailsName}
                        onChangeText={setDetailsName}
                        autoCapitalize="words"
                      />
                    </Input>
                  </Box>
                  <Box className="w-28">
                    <Text className="text-xs text-muted-foreground mb-1">Market</Text>
                    <Input>
                      <InputField value={detailsMarket} onChangeText={setDetailsMarket} />
                    </Input>
                  </Box>
                </Box>

                <Box className="flex-row flex-wrap items-end gap-2">
                  <Box className="min-w-[380px] flex-1">
                    <Text className="text-xs text-muted-foreground mb-1">Institution website</Text>
                    <Input>
                      <InputField
                        value={detailsWebsiteUrl}
                        onChangeText={setDetailsWebsiteUrl}
                        placeholder="https://www.example.edu"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </Input>
                    <Text className="text-[11px] text-muted-foreground mt-1">
                      Theme extraction reads the homepage and same-origin stylesheets only.
                    </Text>
                  </Box>
                  <Button
                    variant="outline"
                    isDisabled={busy === `extract:${detailsInstitution._id}`}
                    onPress={handleExtractTheme}
                  >
                    <ButtonText>
                      {busy === `extract:${detailsInstitution._id}`
                        ? "Extracting..."
                        : "Extract theme from website"}
                    </ButtonText>
                  </Button>
                </Box>
                {extractFeedback ? (
                  <Text
                    className={`text-xs ${
                      extractFeedback.tone === "success"
                        ? "text-[#1f7a45]"
                        : extractFeedback.tone === "warning"
                          ? "text-[#8A5B12]"
                          : "text-muted-foreground"
                    }`}
                  >
                    {extractFeedback.message}
                  </Text>
                ) : null}

                <Box className="flex-row flex-wrap gap-2">
                  <Box className="min-w-[220px] flex-1">
                    <Text className="text-xs text-muted-foreground mb-1">Primary color</Text>
                    <Input>
                      <InputField
                        value={detailsPrimaryColor}
                        onChangeText={setDetailsPrimaryColor}
                        placeholder="#1A365D"
                      />
                    </Input>
                  </Box>
                  <Box className="min-w-[220px] flex-1">
                    <Text className="text-xs text-muted-foreground mb-1">Secondary color</Text>
                    <Input>
                      <InputField
                        value={detailsSecondaryColor}
                        onChangeText={setDetailsSecondaryColor}
                        placeholder="#C53030"
                      />
                    </Input>
                  </Box>
                  <Box className="min-w-[220px] flex-1">
                    <Text className="text-xs text-muted-foreground mb-1">Background color</Text>
                    <Input>
                      <InputField
                        value={detailsBackgroundColor}
                        onChangeText={setDetailsBackgroundColor}
                        placeholder="#0E1B2C"
                      />
                    </Input>
                  </Box>
                  <Box className="min-w-[320px] flex-1">
                    <Text className="text-xs text-muted-foreground mb-1">Logo URL</Text>
                    <Input>
                      <InputField
                        value={detailsLogoUrl}
                        onChangeText={setDetailsLogoUrl}
                        placeholder="https://www.example.edu/logo.svg"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </Input>
                  </Box>
                  <Box className="min-w-[220px] flex-1">
                    <Text className="text-xs text-muted-foreground mb-1">Google font picker</Text>
                    <Box className="rounded-lg border border-border bg-card px-2 py-1.5">
                      <select
                        value={fontSelectValue}
                        onChange={(event) => {
                          if (event.target.value === CUSTOM_FONT_OPTION) return;
                          setDetailsFontFamily(event.target.value);
                        }}
                        style={{
                          width: "100%",
                          border: "none",
                          outline: "none",
                          background: "transparent",
                          fontSize: 13,
                          color: "#1f2937",
                        }}
                      >
                        <option value={CUSTOM_FONT_OPTION}>Custom or existing value</option>
                        {GOOGLE_BRAND_FONT_OPTIONS.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                    </Box>
                  </Box>
                  <Box className="min-w-[220px] flex-1">
                    <Text className="text-xs text-muted-foreground mb-1">Heading case</Text>
                    <Box className="rounded-lg border border-border bg-card px-2 py-1.5">
                      <select
                        value={detailsTitleCase}
                        onChange={(event) =>
                          setDetailsTitleCase(
                            event.target.value === "uppercase" ? "uppercase" : "none"
                          )
                        }
                        style={{
                          width: "100%",
                          border: "none",
                          outline: "none",
                          background: "transparent",
                          fontSize: 13,
                          color: "#1f2937",
                        }}
                      >
                        {HEADING_CASE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Box>
                  </Box>
                  <Box className="min-w-[220px] flex-1">
                    <Text className="text-xs text-muted-foreground mb-1">Font family</Text>
                    <Input>
                      <InputField
                        value={detailsFontFamily}
                        onChangeText={setDetailsFontFamily}
                        placeholder="Montserrat"
                      />
                    </Input>
                    <Text className="text-[11px] text-muted-foreground mt-1">
                      Choose from the picker or type any Google Font family name.
                    </Text>
                  </Box>
                </Box>

                <Box className="flex-row items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant={detailsPlaceholder ? "destructive" : "outline"}
                    onPress={() => setDetailsPlaceholder((value) => !value)}
                  >
                    <ButtonText>
                      {detailsPlaceholder ? "Placeholder theme enabled" : "Use real theme"}
                    </ButtonText>
                  </Button>
                  <Text className="text-xs text-muted-foreground">
                    Placeholder should be off for production institutions.
                  </Text>
                </Box>

                <Box className="gap-1">
                  <Text className="text-xs text-muted-foreground">Live theme preview</Text>
                  <Box className="rounded-xl border border-border overflow-hidden">
                    <Box
                      className="px-4 py-3"
                      style={{ backgroundColor: previewPrimaryColor }}
                    >
                      <Text
                        className="text-base font-semibold"
                        style={{
                          color: textOnColor(previewPrimaryColor),
                          fontFamily: previewFontFamily,
                          textTransform: detailsTitleCase,
                        }}
                      >
                        {detailsName.trim() || "Institution theme"}
                      </Text>
                      <Text
                        className="text-xs"
                        style={{
                          color: textOnColor(previewPrimaryColor),
                          opacity: 0.85,
                          fontFamily: previewFontFamily,
                        }}
                      >
                        Primary {previewPrimaryColor} · Secondary {previewSecondaryColor} ·
                        Background {previewBackgroundColor}
                      </Text>
                    </Box>
                    <Box
                      className="px-4 py-3 gap-2"
                      style={{ backgroundColor: previewBackgroundColor }}
                    >
                      <Box className="rounded-lg border border-border px-3 py-2">
                        <Text
                          className="text-sm"
                          style={{
                            fontFamily: previewFontFamily,
                            color: textOnColor(previewBackgroundColor),
                          }}
                        >
                          This is how cards and controls inherit your brand accent, background,
                          and font.
                        </Text>
                      </Box>
                      {detailsLogoUrl.trim() ? (
                        <Box className="rounded-lg border border-border px-3 py-2 gap-2">
                          <Text
                            className="text-xs"
                            style={{
                              color: textOnColor(previewBackgroundColor),
                              fontFamily: previewFontFamily,
                            }}
                          >
                            Logo preview
                          </Text>
                          <img
                            src={detailsLogoUrl.trim()}
                            alt="Institution logo"
                            style={{
                              maxHeight: 48,
                              maxWidth: 180,
                              objectFit: "contain",
                            }}
                          />
                        </Box>
                      ) : null}
                      <Box className="flex-row items-center gap-2 flex-wrap">
                        <Box
                          className="rounded-full px-2.5 py-1"
                          style={{ backgroundColor: previewSecondaryColor }}
                        >
                          <Text
                            className="text-xs font-semibold"
                            style={{
                              color: textOnColor(previewSecondaryColor),
                              fontFamily: previewFontFamily,
                            }}
                          >
                            Secondary action
                          </Text>
                        </Box>
                        <Box
                          className="rounded-full border px-2.5 py-1"
                          style={{ borderColor: previewPrimaryColor }}
                        >
                          <Text
                            className="text-xs font-semibold"
                            style={{
                              color: previewPrimaryColor,
                              fontFamily: previewFontFamily,
                            }}
                          >
                            Primary outline
                          </Text>
                        </Box>
                      </Box>
                    </Box>
                  </Box>
                </Box>

                <Box className="gap-1">
                  <Text className="text-xs text-muted-foreground">Card preview</Text>
                  <Text className="text-[11px] text-muted-foreground">
                    Left card emphasizes primary; right card emphasizes secondary chip/rule styling.
                  </Text>
                  <Box className="flex-row flex-wrap gap-3">
                    <Box className="w-[210px]">
                      <CardStaticPreview
                        template="title-card"
                        props={titleCardPreviewProps}
                        brandTokens={previewBrandTokens}
                      />
                    </Box>
                    <Box className="w-[210px]">
                      <CardStaticPreview
                        template="persona-card"
                        props={secondaryColorPreviewProps}
                        brandTokens={previewBrandTokens}
                      />
                    </Box>
                  </Box>
                </Box>

                <Box className="flex-row items-center gap-2">
                  <Button
                    isDisabled={busy === `save:${detailsInstitution._id}`}
                    onPress={handleSaveDetails}
                  >
                    <ButtonText>
                      {busy === `save:${detailsInstitution._id}`
                        ? "Saving..."
                        : "Save institution details"}
                    </ButtonText>
                  </Button>
                  <Button
                    variant="outline"
                    onPress={() => hydrateDetails(detailsInstitution._id)}
                  >
                    <ButtonText>Reset changes</ButtonText>
                  </Button>
                </Box>
              </Box>
            </SurfaceCard>
          ) : null}
        </Box>
      </ScrollView>
    </AdminWorkspaceFrame>
  );
}

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readToken(tokens: Record<string, unknown>, key: string): string {
  const value = tokens[key];
  return typeof value === "string" ? value : "";
}

function parseTitleCaseToken(value: unknown): "none" | "uppercase" {
  return value === "uppercase" ? "uppercase" : "none";
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function textOnColor(hex: string): string {
  if (!isHexColor(hex)) return "#111827";
  const value = hex.slice(1);
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? "#111827" : "#FFFFFF";
}
