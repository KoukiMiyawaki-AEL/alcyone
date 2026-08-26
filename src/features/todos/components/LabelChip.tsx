import { cn } from "@/lib/utils";

import type { Label, LabelColor } from "../types";

/**
 * One label, as a chip.
 *
 * The colours are design tokens rather than raw Tailwind palette entries, so a
 * label reads the same way in both themes and a new one cannot arrive with a
 * contrast nobody checked. Written out in full because Tailwind reads class
 * names as literals — a template string would produce no CSS at all.
 */
const COLOR_CLASS: Record<LabelColor, string> = {
  slate: "bg-label-slate/15 text-label-slate border-label-slate/30",
  red: "bg-label-red/15 text-label-red border-label-red/30",
  amber: "bg-label-amber/15 text-label-amber border-label-amber/30",
  green: "bg-label-green/15 text-label-green border-label-green/30",
  blue: "bg-label-blue/15 text-label-blue border-label-blue/30",
  violet: "bg-label-violet/15 text-label-violet border-label-violet/30",
};

export function LabelChip({ label, className }: { label: Label; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-40 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        COLOR_CLASS[label.color],
        className,
      )}
    >
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/** The colour swatch a picker offers, before a label has a name. */
export function LabelSwatch({ color }: { color: LabelColor }) {
  return <span className={cn("size-3 rounded-full border", COLOR_CLASS[color])} aria-hidden />;
}
