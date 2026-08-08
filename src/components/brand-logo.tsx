import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from "@/lib/branding";

// ---------------------------------------------------------------------------
// The one place that answers "what mark and name go in the app chrome".
//
// Falls back down a chain rather than ever rendering nothing:
//   mark:  logo_mark_url  →  logo_initials  →  first letter of app_name  →  Strider's Zap
//   name:  app_name       →  "Strider"
//
// The wide `logo_url` is used only where there's horizontal room (the
// expanded sidebar). Everywhere tight — collapsed sidebar, mobile header —
// falls back to the square mark, because a wide logo squeezed into 28px is
// worse branding than no logo at all.
// ---------------------------------------------------------------------------

const SIZES = {
  sm: { box: "w-6 h-6", icon: "h-3.5 w-3.5", text: "text-[11px]", wordmark: "text-sm", wide: "h-6" },
  md: { box: "w-7 h-7", icon: "h-4 w-4", text: "text-xs", wordmark: "text-base", wide: "h-7" },
} as const;

export function BrandMark({ size = "md", className }: { size?: keyof typeof SIZES; className?: string }) {
  const { branding, appName } = useBranding();
  const s = SIZES[size];

  const markUrl = branding?.logoMarkUrl?.trim() || null;
  const initials = branding?.logoInitials?.trim() || (branding ? appName.trim().charAt(0).toUpperCase() : null);

  if (markUrl) {
    return (
      <img
        src={markUrl}
        alt=""
        // object-contain, not cover: a logo must never be cropped to fill a
        // square. The rounded background behind it keeps the silhouette tidy
        // for marks that aren't square themselves.
        className={cn(s.box, "shrink-0 rounded-md object-contain", className)}
      />
    );
  }

  return (
    <span
      className={cn(
        s.box,
        "grid shrink-0 place-items-center rounded-md bg-[var(--accent-red)] shadow-[0_0_18px_-4px_var(--accent-red)]",
        className,
      )}
    >
      {initials ? (
        <span className={cn(s.text, "font-display font-extrabold tracking-tight text-[var(--primary-foreground)]")}>
          {initials}
        </span>
      ) : (
        <Zap className={cn(s.icon, "text-[var(--primary-foreground)]")} strokeWidth={2.5} />
      )}
    </span>
  );
}

/**
 * Mark + wordmark. `wide` allows the full logo image to replace both when
 * there's room for it.
 */
export function BrandLogo({
  size = "md",
  showWordmark = true,
  allowWide = true,
  className,
}: {
  size?: keyof typeof SIZES;
  showWordmark?: boolean;
  allowWide?: boolean;
  className?: string;
}) {
  const { branding, appName } = useBranding();
  const s = SIZES[size];
  const wideUrl = allowWide && showWordmark ? branding?.logoUrl?.trim() || null : null;

  if (wideUrl) {
    return <img src={wideUrl} alt={appName} className={cn(s.wide, "w-auto max-w-[150px] object-contain", className)} />;
  }

  return (
    <span className={cn("flex items-center gap-2", className)}>
      <BrandMark size={size} />
      {showWordmark && (
        <span className={cn(s.wordmark, "truncate font-display font-extrabold uppercase tracking-tight")}>
          {appName}
        </span>
      )}
    </span>
  );
}

/**
 * Non-removable attribution. Rendered only when branding is actually active —
 * an unbranded Strider install obviously doesn't need to tell you it's
 * Strider. Deliberately quiet (muted, tiny) but always present and always a
 * real link; this is the thing that makes white-labelling a licence rather
 * than a resale.
 */
export function PoweredByStrider({ className }: { className?: string }) {
  const { showPoweredBy } = useBranding();
  if (!showPoweredBy) return null;
  return (
    <div className={cn("px-3 py-1.5 text-[10px] tracking-wide text-muted-foreground/70", className)}>
      Powered by{" "}
      {/* Same relative "/" link the public athlete/coach page footers already
          use for this — deliberately not a hardcoded domain, so it keeps
          working across preview, staging, and production. */}
      <a href="/" target="_blank" rel="noreferrer" className="font-semibold hover:underline">
        Strider
      </a>
    </div>
  );
}
