import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Share, SquarePlus, X, CheckCircle2 } from "lucide-react";
import { usePwaInstall } from "@/lib/pwa-install";
import { BrandMark } from "@/components/brand-logo";
import { useBranding } from "@/lib/branding";

/**
 * Two presentations of the same install offer, sharing all the actual
 * install logic via usePwaInstall():
 *
 *   variant="banner" — compact, dismissible, appears unprompted (mounted in
 *     AppShell) when the platform can actually install and the person
 *     hasn't already brushed it off recently.
 *   variant="card"   — full card for a settings destination (Account), where
 *     someone went looking for this deliberately. Always renders its
 *     content (no dismiss state to check) except when already installed,
 *     where it shows a simple confirmation instead of an offer.
 */
export function PwaInstallPrompt({ variant }: { variant: "banner" | "card" }) {
  const { canPromptInstall, promptInstall, isIOS, isStandalone, shouldOfferInstall, dismiss } = usePwaInstall();
  const { appName } = useBranding();

  if (variant === "banner" && !shouldOfferInstall) return null;
  if (variant === "card" && isStandalone) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-[var(--accent-red)] shrink-0" />
            <div>
              <div className="text-sm font-semibold">Installed</div>
              <div className="text-xs text-muted-foreground">
                You're using {appName} as an installed app on this device.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  async function handleInstall() {
    await promptInstall();
  }

  const body = canPromptInstall ? (
    <>
      <p className="text-sm text-muted-foreground">
        Install {appName} on this device for a faster, full-screen experience — no browser bar, launches straight
        to your training.
      </p>
      <Button size="sm" onClick={handleInstall} className="mt-3">
        <Download className="mr-1.5 h-3.5 w-3.5" />
        Install app
      </Button>
    </>
  ) : isIOS ? (
    <>
      <p className="text-sm text-muted-foreground">
        Add {appName} to your Home Screen for a faster, full-screen experience — no browser bar, launches straight
        to your training.
      </p>
      <ol className="mt-3 space-y-1.5 text-sm">
        <li className="flex items-center gap-2">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-bold">
            1
          </span>
          Tap <Share className="inline h-3.5 w-3.5 mx-0.5" strokeWidth={2.5} /> Share in Safari's toolbar
        </li>
        <li className="flex items-center gap-2">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-bold">
            2
          </span>
          Scroll down and tap <SquarePlus className="inline h-3.5 w-3.5 mx-0.5" strokeWidth={2.5} /> Add to Home
          Screen
        </li>
      </ol>
    </>
  ) : (
    <p className="text-sm text-muted-foreground">
      Your browser doesn't support installing {appName} directly. You can still bookmark this page for quick
      access.
    </p>
  );

  if (variant === "banner") {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-3.5 py-3 print:hidden">
        <BrandMark size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {canPromptInstall ? `Install ${appName}` : `Add ${appName} to your Home Screen`}
          </div>
          <div className="mt-0.5">{body}</div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Install as an app</CardTitle>
        <CardDescription>Get {appName} on your Home Screen.</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
