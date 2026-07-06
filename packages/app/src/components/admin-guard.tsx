"use client";

import { useEffect, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useRouter } from "solito/navigation";
import { Box } from "@app-template/ui";
import { api } from "../db/api";
import { AuthGuard } from "./auth-guard";
import { LoadingSpinner } from "./loading-spinner";

type AdminGuardProps = {
  children: ReactNode;
};

function AdminGate({ children }: AdminGuardProps) {
  const router = useRouter();
  const page = useQuery(api.adminNotifications.getNotificationTestPage);

  useEffect(() => {
    if (page === null) {
      router.replace("/dashboard");
    }
  }, [page, router]);

  if (page === undefined) {
    return (
      <Box className="flex-1 flex-col items-center justify-center bg-background">
        <LoadingSpinner />
      </Box>
    );
  }

  if (page === null) {
    return null;
  }

  return <>{children}</>;
}

/** Requires signed-in app admin. Non-admins are redirected to home. */
export function AdminGuard({ children }: AdminGuardProps) {
  return (
    <AuthGuard>
      <AdminGate>{children}</AdminGate>
    </AuthGuard>
  );
}
