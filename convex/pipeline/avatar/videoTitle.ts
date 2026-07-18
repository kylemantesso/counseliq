type HeyGenVideoTitleInput = {
  courseTitle: string;
  runId: string;
  unitKey: string;
  unitTitle: string;
};

export function heyGenVideoTitle(input: HeyGenVideoTitleInput): string {
  const shortRunId = input.runId.slice(-8);
  const unitMatch = input.unitKey.match(/^mu-(\d+?)(\d{2})$/i);
  const unitLabel = unitMatch
    ? `${Number(unitMatch[1])}.${Number(unitMatch[2])}`
    : input.unitKey;
  return `${input.courseTitle} · ${shortRunId} · ${unitLabel} ${input.unitTitle}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function heyGenAudioFilename(title: string): string {
  const stem = title
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 170);
  return `${stem || "counseliq-narration"}.mp3`;
}
