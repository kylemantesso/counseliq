"use client";

import type { ReactNode } from "react";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { useRouter } from "solito/navigation";
import { Platform } from "react-native";
import {
  Box,
  PageHeader,
  Text,
  WorkspaceShell,
  WorkspaceSidebar,
} from "@counseliq/ui";
import { useAuth } from "../auth";
import { api } from "../db/api";
import { Screen } from "./screen";
import { useSelectedInstitution } from "./admin/use-selected-institution";

type WorkspaceNavKey =
  | "home"
  | "institutions"
  | "source-docs"
  | "assets"
  | "runs"
  | "create-run"
  | "deliveries"
  | "model-routing"
  | "diagnostics";

export function AdminWorkspaceFrame({
  activeNav,
  title,
  titleAccessory,
  description,
  headerActions,
  topbarTrail,
  showPageHeader = true,
  contentClassName,
  contentStyle,
  children,
}: {
  activeNav: WorkspaceNavKey;
  title: string;
  titleAccessory?: ReactNode;
  description?: string;
  headerActions?: ReactNode;
  topbarTrail?: string[];
  showPageHeader?: boolean;
  contentClassName?: string;
  contentStyle?: Record<string, unknown>;
  children: ReactNode;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { institutions, selectedInstitution, selectedInstitutionId, setInstitution } =
    useSelectedInstitution();
  const runs = useQuery(
    api.pipeline.queries.adminListRuns,
    selectedInstitutionId ? { institutionId: selectedInstitutionId } : "skip"
  );

  const needsAttentionCount = useMemo(() => {
    return (runs ?? []).filter((run) =>
      [
        "FAILED",
        "OUTLINE_REVIEW",
        "GATE_2_COURSE_REVIEW",
        "GATE_3_PREVIEW",
        "QA_FLAGGED",
      ].includes(run.state)
    ).length;
  }, [runs]);

  const initials =
    user?.name
      ?.split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "KM";
  const trail = topbarTrail && topbarTrail.length > 0 ? topbarTrail : ["Workspace"];

  return (
    <Screen className="flex-1 bg-background" padding={{ top: 0, bottom: 0 }}>
      <WorkspaceShell
        sidebar={
          <WorkspaceSidebar
            title="CounselIQ"
            sections={[
              {
                key: "workspace",
                label: "Workspace",
                items: [
                  {
                    key: "home",
                    label: "Home",
                    active: activeNav === "home",
                    onPress: () => router.push("/admin"),
                  },
                  {
                    key: "institutions",
                    label: "Institutions",
                    active: activeNav === "institutions",
                    onPress: () => router.push("/admin/institutions"),
                  },
                ],
              },
              {
                key: "libraries",
                label: "Libraries",
                items: [
                  {
                    key: "source-docs",
                    label: "Source documents",
                    active: activeNav === "source-docs",
                    onPress: () => router.push("/admin/source-docs"),
                  },
                  {
                    key: "assets",
                    label: "Assets & rights",
                    active: activeNav === "assets",
                    onPress: () => router.push("/admin/assets"),
                  },
                ],
              },
              {
                key: "runs",
                label: "Generate course",
                items: [
                  {
                    key: "runs",
                    label: "Course queue",
                    active: activeNav === "runs",
                    onPress: () => router.push("/admin/runs"),
                    suffix:
                      needsAttentionCount > 0 ? (
                        <Box
                          className={`h-5 min-w-5 items-center justify-center rounded-full px-1.5 ${
                            activeNav === "runs" ? "bg-primary-foreground/20" : "bg-secondary"
                          }`}
                        >
                          <Text
                            className={`text-[11px] font-semibold ${
                              activeNav === "runs"
                                ? "text-primary-foreground"
                                : "text-secondary-foreground"
                            }`}
                          >
                            {needsAttentionCount}
                          </Text>
                        </Box>
                      ) : null,
                  },
                  {
                    key: "create-run",
                    label: "Create course",
                    active: activeNav === "create-run",
                    onPress: () => router.push("/admin/runs/new"),
                  },
                ],
              },
              {
                key: "ops",
                label: "Operations",
                items: [
                  {
                    key: "deliveries",
                    label: "Delivery log",
                    active: activeNav === "deliveries",
                    onPress: () => router.push("/admin/notification-deliveries"),
                  },
                  {
                    key: "model-routing",
                    label: "Model routing",
                    active: activeNav === "model-routing",
                    onPress: () => router.push("/admin/model-routing"),
                  },
                  {
                    key: "diagnostics",
                    label: "Diagnostics",
                    active: activeNav === "diagnostics",
                    onPress: () => router.push("/admin/email-test"),
                  },
                ],
              },
            ]}
          />
        }
        topbar={
          <Box className="min-h-14 flex-row flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3 md:px-7">
            <Box className="min-w-0 flex-row flex-wrap items-center gap-3">
              {Platform.OS === "web" ? (
                <Box className="max-w-[280px] flex-row items-center gap-2 rounded-full border border-input bg-card px-3 py-1.5">
                  <Box className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <select
                    aria-label="Institution"
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] font-semibold text-foreground outline-none"
                    value={selectedInstitutionId ?? ""}
                    onChange={(event) => setInstitution(event.target.value as never)}
                  >
                    {(institutions ?? []).map((institution) => (
                      <option key={institution._id} value={institution._id}>
                        {institution.name}
                      </option>
                    ))}
                  </select>
                </Box>
              ) : (
                <Box className="max-w-[280px] flex-row items-center gap-2 rounded-full border border-input bg-card px-3 py-1.5">
                  <Box className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <Text className="text-[13px] font-semibold" isTruncated>
                    {selectedInstitution?.name ?? "No institution"}
                  </Text>
                </Box>
              )}
              {trail.map((item, index) => (
                <Box key={`${item}-${index}`} className="flex-row items-center gap-3">
                  <Text className="text-sm text-muted-foreground">/</Text>
                  <Text
                    className={`text-sm ${
                      index === trail.length - 1
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {item}
                  </Text>
                </Box>
              ))}
            </Box>
            <Box className="ml-auto flex-row items-center gap-3">
              <Box className="h-8 w-8 items-center justify-center rounded-full bg-primary">
                <Text className="text-xs font-semibold text-primary-foreground">{initials}</Text>
              </Box>
            </Box>
          </Box>
        }
      >
        <Box
          className={
            contentClassName ??
            "flex-1 gap-[22px] p-4 md:px-7 md:py-6 lg:px-9 lg:pb-10 lg:pt-[30px]"
          }
          style={({ overflow: "auto", ...contentStyle } as never)}
        >
          {showPageHeader ? (
            <PageHeader
              title={title}
              titleAccessory={titleAccessory}
              description={description}
              actions={headerActions}
            />
          ) : null}
          {children}
        </Box>
      </WorkspaceShell>
    </Screen>
  );
}
