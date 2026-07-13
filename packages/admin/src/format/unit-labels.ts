export function parseGeneratedUnitPosition(
  unitKey: string
): { moduleNumber: number; unitNumber: number } | null {
  const match = unitKey.trim().match(/^mu-(\d+?)(\d{2})$/i);
  if (!match) return null;
  const moduleNumber = Number(match[1]);
  const unitNumber = Number(match[2]);
  if (!Number.isFinite(moduleNumber) || !Number.isFinite(unitNumber)) return null;
  return { moduleNumber, unitNumber };
}

export function formatUnitPositionLabel(unitKey: string, fallback?: string): string {
  const parsed = parseGeneratedUnitPosition(unitKey);
  if (parsed) return `${parsed.moduleNumber}.${parsed.unitNumber}`;
  return fallback ?? "Unit";
}

export function humanizeGeneratedUnitKeyText(text: string): string {
  return text.replace(/\bmu-(\d+?)(\d{2})\b/gi, (unitKey) =>
    formatUnitPositionLabel(unitKey)
  );
}

export function parseGeneratedModuleNumber(moduleKey: string): number | null {
  const match = moduleKey.trim().match(/^m(\d+)/i);
  if (!match) return null;
  const moduleNumber = Number(match[1]);
  return Number.isFinite(moduleNumber) ? moduleNumber : null;
}

export function formatModuleNumberLabel(
  moduleKey: string,
  fallbackIndex?: number,
  options?: { includeWord?: boolean }
): string {
  const moduleNumber =
    parseGeneratedModuleNumber(moduleKey) ??
    (typeof fallbackIndex === "number" ? fallbackIndex + 1 : null);
  if (moduleNumber === null) return options?.includeWord ? "Module" : "";
  return options?.includeWord ? `Module ${moduleNumber}` : String(moduleNumber);
}
