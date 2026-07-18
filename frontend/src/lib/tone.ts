export type Tone = "neutral" | "teal" | "amber" | "red";

export function toneVars(tone: Tone): { bg: string; fg: string; bd: string } {
  switch (tone) {
    case "teal":
      return { bg: "var(--color-primary-soft)", fg: "var(--color-primary)", bd: "var(--color-primary-soft-border)" };
    case "amber":
      return { bg: "var(--color-warning-soft)", fg: "var(--color-warning)", bd: "var(--color-warning-soft-border)" };
    case "red":
      return { bg: "var(--color-destructive-soft)", fg: "var(--color-destructive)", bd: "var(--color-destructive-soft-border)" };
    default:
      return { bg: "var(--color-secondary)", fg: "color-mix(in oklab, var(--color-foreground) 70%, transparent)", bd: "var(--color-border)" };
  }
}

export function toneFg(tone?: Tone): string {
  if (!tone) return "var(--color-foreground)";
  return toneVars(tone).fg;
}
