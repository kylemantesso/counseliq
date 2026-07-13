"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import {
  Box,
  Button,
  ButtonText,
  Input,
  InputField,
  Pressable,
  ScrollView,
  Text,
} from "@counseliq/ui";
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
import {
  CARD_PREVIEW_TEMPLATES,
  formatTemplateName,
  genericInstitutionCardProps,
} from "./institution-card-preview-data";

const CUSTOM_FONT_OPTION = "__custom__";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MARKET_OPTIONS = ["AU", "NZ", "US", "UK", "CA"];
const HEADING_CASE_OPTIONS = [
  { value: "none", label: "Sentence" },
  { value: "uppercase", label: "UPPER" },
] as const;

type InstitutionTab = "details" | "preview";

export function AdminInstitutionsScreen() {
  return (
    <AdminGuard>
      <AdminInstitutionsContent />
    </AdminGuard>
  );
}

function AdminInstitutionsContent() {
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const { institutions, selectedInstitutionId, setInstitution } = useSelectedInstitution();
  const createInstitution = useMutation(api.pipeline.assetsCatalogue.adminCreateInstitution);
  const updateInstitution = useMutation(api.pipeline.assetsCatalogue.adminUpdateInstitution);
  const generateLogoUploadUrl = useMutation(
    api.pipeline.assetsCatalogue.adminGenerateInstitutionLogoUploadUrl
  );
  const resolveLogoStorageUrl = useMutation(
    api.pipeline.assetsCatalogue.adminResolveInstitutionLogoStorageUrl
  );
  const extractThemeFromWebsite = useAction(
    api.pipeline.institutionTheme.adminExtractInstitutionThemeFromWebsite
  );
  const copyLogoFromUrl = useAction(
    api.pipeline.institutionTheme.adminCopyInstitutionLogoFromUrl
  );

  const [createName, setCreateName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<InstitutionTab>("details");
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
  const [detailsLogoStorageId, setDetailsLogoStorageId] = useState("");
  const [detailsTitleFontFamily, setDetailsTitleFontFamily] = useState("");
  const [detailsBodyFontFamily, setDetailsBodyFontFamily] = useState("");
  const [detailsTitleCase, setDetailsTitleCase] = useState<"none" | "uppercase">(
    "none"
  );
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
  const filteredRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
      return `${row.name} ${row.market ?? ""}`.toLowerCase().includes(query);
    });
  }, [rows, searchTerm]);

  const detailsInstitution =
    detailsInstitutionId === null
      ? null
      : rows.find((row) => row._id === detailsInstitutionId) ?? null;
  const previewPrimaryColor = isHexColor(detailsPrimaryColor.trim())
    ? detailsPrimaryColor.trim()
    : "#211545";
  const previewSecondaryColor = isHexColor(detailsSecondaryColor.trim())
    ? detailsSecondaryColor.trim()
    : "#257A87";
  const previewBackgroundColor = isHexColor(detailsBackgroundColor.trim())
    ? detailsBackgroundColor.trim()
    : "#FFFFFF";
  const previewTitleFontFamily = detailsTitleFontFamily.trim() || "system-ui";
  const previewBodyFontFamily = detailsBodyFontFamily.trim() || "system-ui";
  const previewInstitutionName = detailsName.trim() || "Institution";
  const previewBrandTokens = useMemo(
    () => ({
      primaryColor: previewPrimaryColor,
      secondaryColor: previewSecondaryColor,
      backgroundColor: previewBackgroundColor,
      ...(detailsLogoUrl.trim() ? { logoUrl: detailsLogoUrl.trim() } : {}),
      titleFontFamily: previewTitleFontFamily,
      bodyFontFamily: previewBodyFontFamily,
      titleCase: detailsTitleCase,
    }),
    [
      previewPrimaryColor,
      previewSecondaryColor,
      previewBackgroundColor,
      detailsLogoUrl,
      previewTitleFontFamily,
      previewBodyFontFamily,
      detailsTitleCase,
    ]
  );

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
    setDetailsLogoStorageId(readToken(tokens, "logoStorageId"));
    setDetailsTitleFontFamily(
      readToken(tokens, "titleFontFamily") || readToken(tokens, "fontFamily")
    );
    setDetailsBodyFontFamily(readToken(tokens, "bodyFontFamily"));
    setDetailsTitleCase(parseTitleCaseToken(tokens.titleCase));
    setExtractFeedback(null);
  }

  function selectInstitutionForDetails(institutionId: Id<"institutions">) {
    setInstitution(institutionId);
    hydrateDetails(institutionId);
    setError(null);
    setNotice(null);
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
      setShowCreate(false);
      setInstitution(result.institutionId);
      hydrateDetails(result.institutionId);
    } catch (createError) {
      setError(getUserFacingErrorMessage(createError, "Could not create institution."));
    } finally {
      setBusy(null);
    }
  }

  async function ensureStoredLogo(): Promise<{
    logoUrl: string;
    logoStorageId: string;
  }> {
    if (!detailsInstitutionId) return { logoUrl: "", logoStorageId: "" };
    const logoUrl = detailsLogoUrl.trim();
    if (!logoUrl) return { logoUrl: "", logoStorageId: "" };
    if (detailsLogoStorageId.trim()) {
      return { logoUrl, logoStorageId: detailsLogoStorageId.trim() };
    }
    const copied = await copyLogoFromUrl({
      institutionId: detailsInstitutionId,
      logoUrl,
    });
    setDetailsLogoUrl(copied.logoUrl);
    setDetailsLogoStorageId(copied.logoStorageId);
    return copied;
  }

  async function handleLogoFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file || !detailsInstitutionId) return;
    if (!file.type.startsWith("image/") || file.size <= 0 || file.size > MAX_LOGO_BYTES) {
      setError("Logo must be an image file under 2 MB.");
      return;
    }

    setBusy(`logo-upload:${detailsInstitutionId}`);
    setError(null);
    setNotice(null);
    try {
      const { uploadUrl } = await generateLogoUploadUrl({
        institutionId: detailsInstitutionId,
      });
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error(`upload failed (${uploadResponse.status})`);
      }
      const uploadResult = (await uploadResponse.json()) as { storageId?: string };
      if (!uploadResult.storageId) {
        throw new Error("upload did not return a storage id");
      }
      const resolved = await resolveLogoStorageUrl({
        storageId: uploadResult.storageId as never,
      });
      setDetailsLogoUrl(resolved.logoUrl);
      setDetailsLogoStorageId(String(resolved.logoStorageId));
      setNotice("Logo uploaded. Save institution details to apply it.");
    } catch (uploadError) {
      setError(getUserFacingErrorMessage(uploadError, "Could not upload logo. Try again."));
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
    if (detailsPrimaryColor.trim() && !isHexColor(detailsPrimaryColor.trim())) {
      setError("Primary color must be a valid hex value like #1A365D.");
      return;
    }
    if (detailsSecondaryColor.trim() && !isHexColor(detailsSecondaryColor.trim())) {
      setError("Secondary color must be a valid hex value like #C53030.");
      return;
    }
    if (detailsBackgroundColor.trim() && !isHexColor(detailsBackgroundColor.trim())) {
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
      const storedLogo = await ensureStoredLogo();
      await updateInstitution({
        institutionId: detailsInstitutionId,
        name: nextName,
        market: detailsMarket.trim() || "AU",
        websiteUrl: detailsWebsiteUrl.trim() || null,
        brandTokens: {
          ...(detailsPrimaryColor.trim() ? { primaryColor: detailsPrimaryColor.trim() } : {}),
          ...(detailsSecondaryColor.trim()
            ? { secondaryColor: detailsSecondaryColor.trim() }
            : {}),
          ...(detailsBackgroundColor.trim()
            ? { backgroundColor: detailsBackgroundColor.trim() }
            : {}),
          ...(storedLogo.logoUrl ? { logoUrl: storedLogo.logoUrl } : {}),
          ...(storedLogo.logoStorageId ? { logoStorageId: storedLogo.logoStorageId } : {}),
          ...(detailsTitleFontFamily.trim()
            ? { titleFontFamily: detailsTitleFontFamily.trim() }
            : {}),
          ...(detailsBodyFontFamily.trim()
            ? { bodyFontFamily: detailsBodyFontFamily.trim() }
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
      if (extracted.logoStorageId) setDetailsLogoStorageId(String(extracted.logoStorageId));
      if (extracted.fontFamily) setDetailsTitleFontFamily(extracted.fontFamily);
      if (extracted.fontFamily) applied += 1;
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
      topbarTrail={["Workspace", "Institutions"]}
      showPageHeader={false}
      contentClassName="flex-1 bg-background p-0"
      contentStyle={{ overflow: "hidden" }}
    >
      <GoogleBrandFontLoader fontFamilies={[previewTitleFontFamily, previewBodyFontFamily]} />
      <Box className="flex-1 min-h-0 flex-col bg-background lg:flex-row">
        <Box className="w-full shrink-0 gap-4 border-b border-border bg-[#F8F7F4] p-4 lg:h-full lg:w-[292px] lg:border-b-0 lg:border-r lg:p-5">
          <Box className="flex-row items-center justify-between gap-3">
            <Text className="text-[22px] font-bold tracking-[-0.03em] text-foreground">
              Institutions
            </Text>
            <Text className="text-xs font-semibold tracking-[0.18em] text-muted-foreground">
              {rows.length} total
            </Text>
          </Box>

          <Button className="h-11 rounded-xl" onPress={() => setShowCreate((value) => !value)}>
            <ButtonText>{showCreate ? "Close" : "+ New institution"}</ButtonText>
          </Button>

          {showCreate ? (
            <Box className="gap-2 rounded-2xl border border-border bg-card p-3">
              <Input>
                <InputField
                  value={createName}
                  onChangeText={setCreateName}
                  placeholder="Institution name"
                  autoCapitalize="words"
                />
              </Input>
              <Button isDisabled={busy === "create"} onPress={handleCreate}>
                <ButtonText>{busy === "create" ? "Creating..." : "Create"}</ButtonText>
              </Button>
            </Box>
          ) : null}

          <Input>
            <InputField
              value={searchTerm}
              onChangeText={setSearchTerm}
              placeholder="Search institutions"
              autoCapitalize="none"
            />
          </Input>

          <ScrollView className="min-h-0 flex-1">
            <Box className="gap-2 pb-2">
              {!institutions ? (
                <Text className="text-sm text-muted-foreground">Loading institutions...</Text>
              ) : filteredRows.length === 0 ? (
                <Text className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
                  No institutions match your search.
                </Text>
              ) : (
                filteredRows.map((institution) => {
                  const isEditing = institution._id === detailsInstitutionId;
                  const isSelected = institution._id === selectedInstitutionId;
                  return (
                    <Pressable
                      key={institution._id}
                      className={`flex-row items-center gap-3 rounded-2xl border p-3 ${
                        isEditing
                          ? "border-border bg-card shadow-sm"
                          : "border-transparent bg-transparent data-[hover=true]:bg-card/70"
                      }`}
                      onPress={() => selectInstitutionForDetails(institution._id)}
                    >
                      <Box
                        className="h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: isEditing ? previewPrimaryColor : "#164E63" }}
                      >
                        <Text className="text-xs font-bold text-white">
                          {institutionInitials(institution.name)}
                        </Text>
                      </Box>
                      <Box className="min-w-0 flex-1">
                        <Text className="text-[13px] font-bold text-foreground" numberOfLines={1}>
                          {institution.name}
                        </Text>
                        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                          {institution.market || "AU"}
                        </Text>
                      </Box>
                      {isSelected ? <Box className="h-2 w-2 rounded-full bg-[#0F8A44]" /> : null}
                    </Pressable>
                  );
                })
              )}
            </Box>
          </ScrollView>
        </Box>

        <Box className="min-h-0 min-w-0 flex-1 bg-background">
          {detailsInstitution ? (
            <Box className="flex-1 min-h-0">
              <ScrollView className="flex-1">
                <Box className="gap-6 px-5 pb-8 pt-5 md:px-8 lg:px-9">
                  <Box className="gap-1">
                    <Box className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-[25px] font-bold tracking-[-0.03em] text-foreground">
                        {previewInstitutionName}
                      </Text>
                      <Box className="rounded-full border border-border bg-card px-2 py-0.5">
                        <Text className="text-xs font-bold text-secondary-foreground">
                          {detailsMarket.trim() || "AU"} market
                        </Text>
                      </Box>
                    </Box>
                    <Text className="text-sm text-muted-foreground">
                      Created {shortDate(detailsInstitution._creationTime)} · theme tokens drive course styling in preview and publish
                    </Text>
                  </Box>

                  <Box className="flex-row items-end gap-6 border-b border-border">
                    <Pressable
                      className={`pb-3 ${activeTab === "details" ? "border-b-2 border-primary" : ""}`}
                      onPress={() => setActiveTab("details")}
                    >
                      <Text
                        className={`text-sm font-bold ${
                          activeTab === "details" ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        Institution details
                      </Text>
                    </Pressable>
                    <Pressable
                      className={`pb-3 ${activeTab === "preview" ? "border-b-2 border-primary" : ""}`}
                      onPress={() => setActiveTab("preview")}
                    >
                      <Text
                        className={`text-sm font-bold ${
                          activeTab === "preview" ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        Card preview · {CARD_PREVIEW_TEMPLATES.length}
                      </Text>
                    </Pressable>
                  </Box>

                  {activeTab === "details" ? (
                    <>
                      {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
                      {notice ? <Text className="text-sm text-[#1f7a45]">{notice}</Text> : null}

                      <Box className="flex-col gap-8 xl:flex-row xl:items-start">
                    <Box className="min-w-0 flex-1 gap-8">
                      <Box className="gap-4">
                        <SectionLabel>Identity</SectionLabel>
                        <Box className="flex-col gap-3 md:flex-row">
                          <Box className="min-w-0 flex-1 gap-1.5">
                            <FieldLabel>Institution name</FieldLabel>
                            <Input>
                              <InputField
                                value={detailsName}
                                onChangeText={setDetailsName}
                                autoCapitalize="words"
                              />
                            </Input>
                          </Box>
                          <Box className="w-full gap-1.5 md:w-[145px]">
                            <FieldLabel>Market</FieldLabel>
                            <Box className="h-[42px] justify-center rounded-xl border border-border bg-card px-3">
                              <select
                                value={detailsMarket}
                                onChange={(event) => setDetailsMarket(event.target.value)}
                                style={selectStyle}
                              >
                                {!MARKET_OPTIONS.includes(detailsMarket) && detailsMarket ? (
                                  <option value={detailsMarket}>{detailsMarket}</option>
                                ) : null}
                                {MARKET_OPTIONS.map((market) => (
                                  <option key={market} value={market}>
                                    {market}
                                  </option>
                                ))}
                              </select>
                            </Box>
                          </Box>
                        </Box>

                        <Box className="flex-col gap-3 md:flex-row md:items-end">
                          <Box className="min-w-0 flex-1 gap-1.5">
                            <FieldLabel>Website</FieldLabel>
                            <Input>
                              <InputField
                                value={detailsWebsiteUrl}
                                onChangeText={setDetailsWebsiteUrl}
                                placeholder="https://www.example.edu"
                                autoCapitalize="none"
                                autoCorrect={false}
                              />
                            </Input>
                            <Text className="text-[11px] text-muted-foreground">
                              Reads the homepage and same-origin stylesheets to auto-fill colours and fonts below.
                            </Text>
                          </Box>
                          <Button
                            className="h-[42px] rounded-xl"
                            variant="outline"
                            isDisabled={busy === `extract:${detailsInstitution._id}`}
                            onPress={handleExtractTheme}
                          >
                            <ButtonText>
                              {busy === `extract:${detailsInstitution._id}`
                                ? "Extracting..."
                                : "+ Extract theme"}
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
                      </Box>

                      <DividerLine />

                      <Box className="gap-4">
                        <SectionLabel>Brand palette</SectionLabel>
                        <Box className="flex-col gap-3 md:flex-row">
                          <ColorField
                            label="Primary"
                            value={detailsPrimaryColor}
                            previewValue={previewPrimaryColor}
                            placeholder="#211545"
                            onChange={setDetailsPrimaryColor}
                          />
                          <ColorField
                            label="Secondary"
                            value={detailsSecondaryColor}
                            previewValue={previewSecondaryColor}
                            placeholder="#257A87"
                            onChange={setDetailsSecondaryColor}
                          />
                          <ColorField
                            label="Background"
                            value={detailsBackgroundColor}
                            previewValue={previewBackgroundColor}
                            placeholder="#FFFFFF"
                            onChange={setDetailsBackgroundColor}
                          />
                        </Box>
                        <Box className="gap-1.5">
                          <FieldLabel>Logo</FieldLabel>
                          <input
                            ref={logoInputRef}
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(event) => void handleLogoFileSelected(event)}
                          />
                          <Box className="flex-col gap-2 md:flex-row md:items-center">
                            <Box className="min-w-0 flex-1">
                              <Input>
                                <InputField
                                  value={detailsLogoUrl}
                                  onChangeText={(value) => {
                                    setDetailsLogoUrl(value);
                                    setDetailsLogoStorageId("");
                                  }}
                                  placeholder="https://www.example.edu/logo.svg"
                                  autoCapitalize="none"
                                  autoCorrect={false}
                                />
                              </Input>
                            </Box>
                            <Button
                              className="h-[42px] rounded-xl"
                              variant="outline"
                              isDisabled={busy !== null}
                              onPress={() => logoInputRef.current?.click()}
                            >
                              <ButtonText>
                                {busy === `logo-upload:${detailsInstitution._id}`
                                  ? "Uploading..."
                                  : "Upload logo"}
                              </ButtonText>
                            </Button>
                          </Box>
                          <Text className="text-[11px] text-muted-foreground">
                            Uploaded, extracted, and pasted logos are copied into CounselIQ storage.
                          </Text>
                        </Box>
                      </Box>

                      <DividerLine />

                      <Box className="gap-4">
                        <SectionLabel>Typography</SectionLabel>
                        <Box className="flex-col gap-3 md:flex-row">
                          <FontFamilyField
                            label="Title font"
                            value={detailsTitleFontFamily}
                            placeholder="Playfair Display"
                            description="Used for card headings and titles. Any Google Font family name works."
                            onChange={setDetailsTitleFontFamily}
                          />
                          <FontFamilyField
                            label="Body font"
                            value={detailsBodyFontFamily}
                            placeholder="Open Sans"
                            description="Used for body text, answers, explanations, and questions."
                            onChange={setDetailsBodyFontFamily}
                          />
                          <Box className="w-full gap-1.5 md:w-[260px]">
                            <FieldLabel>Heading case</FieldLabel>
                            <Box className="h-[42px] flex-row overflow-hidden rounded-xl border border-border bg-muted p-1">
                              {HEADING_CASE_OPTIONS.map((option) => {
                                const active = detailsTitleCase === option.value;
                                return (
                                  <Pressable
                                    key={option.value}
                                    className={`flex-1 items-center justify-center rounded-lg px-3 ${
                                      active ? "bg-card" : "bg-transparent"
                                    }`}
                                    onPress={() => setDetailsTitleCase(option.value)}
                                  >
                                    <Text
                                      className={`text-xs font-bold ${
                                        active ? "text-foreground" : "text-muted-foreground"
                                      }`}
                                    >
                                      {option.label}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </Box>
                          </Box>
                        </Box>

                      </Box>
                    </Box>

                    <Box className="w-full gap-3 xl:w-[360px]">
                      <SectionLabel>Live theme preview</SectionLabel>
                      <LiveThemePreview
                        institutionName={previewInstitutionName}
                        primaryColor={previewPrimaryColor}
                        secondaryColor={previewSecondaryColor}
                        backgroundColor={previewBackgroundColor}
                        titleFontFamily={previewTitleFontFamily}
                        bodyFontFamily={previewBodyFontFamily}
                        titleCase={detailsTitleCase}
                        logoUrl={detailsLogoUrl.trim()}
                      />
                      <Button className="h-12 rounded-xl" onPress={() => setActiveTab("preview")}>
                        <ButtonText>
                          Preview all {CARD_PREVIEW_TEMPLATES.length} cards with this theme
                        </ButtonText>
                      </Button>
                    </Box>
                  </Box>
                    </>
                  ) : (
                    <InstitutionCardPreviewTab
                      institutionName={previewInstitutionName}
                      market={detailsMarket.trim() || "AU"}
                      brandTokens={previewBrandTokens}
                    />
                  )}
                </Box>
              </ScrollView>

              {activeTab === "details" ? (
                <Box className="shrink-0 flex-row flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-5 py-3 md:px-8 lg:px-9">
                  <Text className="text-xs text-muted-foreground">
                    {error ? "Fix the highlighted issue before saving." : notice ?? "All changes saved."}
                  </Text>
                  <Box className="flex-row items-center gap-2">
                    <Button variant="outline" onPress={() => hydrateDetails(detailsInstitution._id)}>
                      <ButtonText>Reset changes</ButtonText>
                    </Button>
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
                  </Box>
                </Box>
              ) : null}
            </Box>
          ) : (
            <Box className="flex-1 items-center justify-center p-8">
              <Text className="text-sm text-muted-foreground">
                Create or select an institution to edit its theme.
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    </AdminWorkspaceFrame>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </Text>
  );
}

function InstitutionCardPreviewTab({
  institutionName,
  market,
  brandTokens,
}: {
  institutionName: string;
  market: string;
  brandTokens: Record<string, unknown>;
}) {
  return (
    <Box className="gap-5">
      <Box className="flex-row flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
        <Box className="gap-1">
          <Text className="text-sm font-bold text-foreground">
            {CARD_PREVIEW_TEMPLATES.length} card templates
          </Text>
          <Text className="text-xs text-muted-foreground">
            Generic {market} course content rendered with the current theme values.
          </Text>
        </Box>
        <Box className="flex-row flex-wrap gap-2">
          <TokenPill label="Primary" value={readToken(brandTokens, "primaryColor") || "default"} />
          <TokenPill label="Secondary" value={readToken(brandTokens, "secondaryColor") || "default"} />
          <TokenPill label="Background" value={readToken(brandTokens, "backgroundColor") || "default"} />
        </Box>
      </Box>

      <Box
        style={{
          display: "grid",
          gap: 20,
          gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
        } as never}
      >
        {CARD_PREVIEW_TEMPLATES.map((template) => (
          <Box key={template} className="gap-2">
            <Box className="overflow-hidden rounded-2xl border border-border bg-card p-2">
              <Box style={{ aspectRatio: 9 / 16 } as never}>
                <CardStaticPreview
                  template={template}
                  props={genericInstitutionCardProps(template, institutionName, market)}
                  brandTokens={brandTokens}
                  showControls={false}
                />
              </Box>
            </Box>
            <Text className="text-center text-xs font-bold text-muted-foreground">
              {formatTemplateName(template)}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function TokenPill({ label, value }: { label: string; value: string }) {
  return (
    <Box className="rounded-full border border-border bg-background px-3 py-1">
      <Text className="text-xs font-bold text-secondary-foreground">
        {label}: {value}
      </Text>
    </Box>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </Text>
  );
}

function DividerLine() {
  return <Box className="h-px w-full bg-border" />;
}

function ColorField({
  label,
  value,
  previewValue,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  previewValue: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <Box className="min-w-[170px] flex-1 gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Box className="flex-row items-center gap-2">
        <Box
          className="h-[22px] w-[22px] rounded border border-border"
          style={{ backgroundColor: previewValue }}
        />
        <Box className="min-w-0 flex-1">
          <Input>
            <InputField value={value} onChangeText={onChange} placeholder={placeholder} />
          </Input>
        </Box>
      </Box>
    </Box>
  );
}

function FontFamilyField({
  label,
  value,
  placeholder,
  description,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  description: string;
  onChange: (value: string) => void;
}) {
  const normalizedFontFamily = normalizeFontFamily(value);
  const selectValue =
    normalizedFontFamily &&
    GOOGLE_BRAND_FONT_OPTIONS.includes(
      normalizedFontFamily as (typeof GOOGLE_BRAND_FONT_OPTIONS)[number]
    )
      ? normalizedFontFamily
      : CUSTOM_FONT_OPTION;

  return (
    <Box className="min-w-0 flex-1 gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Box className="h-[42px] justify-center rounded-xl border border-border bg-card px-3">
        <select
          value={selectValue}
          onChange={(event) => {
            if (event.target.value === CUSTOM_FONT_OPTION) return;
            onChange(event.target.value);
          }}
          style={selectStyle}
        >
          <option value={CUSTOM_FONT_OPTION}>Custom or existing value</option>
          {GOOGLE_BRAND_FONT_OPTIONS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </Box>
      <Input>
        <InputField
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
        />
      </Input>
      <Text className="text-[11px] text-muted-foreground">{description}</Text>
    </Box>
  );
}

function LiveThemePreview({
  institutionName,
  primaryColor,
  secondaryColor,
  backgroundColor,
  titleFontFamily,
  bodyFontFamily,
  titleCase,
  logoUrl,
}: {
  institutionName: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  titleFontFamily: string;
  bodyFontFamily: string;
  titleCase: "none" | "uppercase";
  logoUrl: string;
}) {
  return (
    <Box className="overflow-hidden rounded-2xl border border-border bg-card">
      <Box className="gap-0.5 px-4 py-3" style={{ backgroundColor: primaryColor }}>
        <Text
          className="text-lg font-bold"
          style={{
            color: textOnColor(primaryColor),
            fontFamily: titleFontFamily,
            textTransform: titleCase,
          }}
        >
          {institutionName}
        </Text>
        <Text
          className="text-xs font-bold"
          style={{ color: textOnColor(primaryColor), fontFamily: bodyFontFamily, opacity: 0.88 }}
        >
          Primary {primaryColor} · Secondary {secondaryColor}
        </Text>
      </Box>
      <Box className="gap-3 p-4" style={{ backgroundColor }}>
        <Box className="rounded-xl border border-border bg-card/80 px-4 py-3">
          <Text className="text-sm leading-5 text-foreground" style={{ fontFamily: bodyFontFamily }}>
            This is how cards and controls inherit your brand accent, background, title font, and body font.
          </Text>
        </Box>
        <Box className="gap-1.5 rounded-xl border border-dashed border-border bg-card/60 p-3">
          <Text className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Logo
          </Text>
          <Box className="h-14 items-center justify-center rounded-lg bg-background">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Institution logo"
                style={{ maxHeight: 36, maxWidth: 190, objectFit: "contain" }}
              />
            ) : (
              <Text className="text-xs text-muted-foreground">[ {institutionName} logo ]</Text>
            )}
          </Box>
        </Box>
        <Box className="flex-row gap-2">
          <Box
            className="flex-1 items-center rounded-lg px-3 py-2.5"
            style={{ backgroundColor: secondaryColor }}
          >
            <Text
              className="text-xs font-bold"
              style={{ color: textOnColor(secondaryColor), fontFamily: bodyFontFamily }}
            >
              Secondary action
            </Text>
          </Box>
          <Box
            className="flex-1 items-center rounded-lg border px-3 py-2.5"
            style={{ borderColor: primaryColor }}
          >
            <Text className="text-xs font-bold" style={{ color: primaryColor, fontFamily: bodyFontFamily }}>
              Primary outline
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

const selectStyle = {
  width: "100%",
  border: "none",
  outline: "none",
  background: "transparent",
  color: "#111827",
  fontSize: 13,
  fontWeight: 700,
} as const;

function institutionInitials(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "I";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
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
