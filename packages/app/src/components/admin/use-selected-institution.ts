"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../db/api";

const STORAGE_KEY = "counseliq.admin.selectedInstitutionId";
const INSTITUTION_CHANGE_EVENT = "counseliq:institution-change";

export function useSelectedInstitution() {
  const institutions = useQuery(api.pipeline.assetsCatalogue.adminListInstitutions, {});
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<
    Id<"institutions"> | null
  >(null);

  useEffect(() => {
    if (!institutions || institutions.length === 0) {
      setSelectedInstitutionId(null);
      return;
    }

    const ids = new Set(institutions.map((institution) => institution._id));
    const firstId = institutions[0]?._id ?? null;

    if (selectedInstitutionId && ids.has(selectedInstitutionId)) {
      return;
    }

    let nextId: Id<"institutions"> | null = firstId;
    if (typeof window !== "undefined") {
      const storedId = window.localStorage.getItem(STORAGE_KEY) as
        | Id<"institutions">
        | null;
      if (storedId && ids.has(storedId)) {
        nextId = storedId;
      }
    }

    setSelectedInstitutionId(nextId);
  }, [institutions, selectedInstitutionId]);

  const setInstitution = (institutionId: Id<"institutions">) => {
    setSelectedInstitutionId(institutionId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, institutionId);
      window.dispatchEvent(
        new CustomEvent(INSTITUTION_CHANGE_EVENT, { detail: institutionId })
      );
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncFromStorage = (nextValue: string | null) => {
      if (!nextValue) {
        setSelectedInstitutionId(null);
        return;
      }
      setSelectedInstitutionId(nextValue as Id<"institutions">);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      syncFromStorage(event.newValue);
    };

    const onCustomEvent = (event: Event) => {
      const customEvent = event as CustomEvent<string | null>;
      syncFromStorage(customEvent.detail ?? window.localStorage.getItem(STORAGE_KEY));
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(INSTITUTION_CHANGE_EVENT, onCustomEvent as EventListener);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        INSTITUTION_CHANGE_EVENT,
        onCustomEvent as EventListener
      );
    };
  }, []);

  const selectedInstitution = useMemo(
    () => institutions?.find((institution) => institution._id === selectedInstitutionId) ?? null,
    [institutions, selectedInstitutionId]
  );

  return {
    institutions,
    selectedInstitution,
    selectedInstitutionId,
    setInstitution,
  };
}
