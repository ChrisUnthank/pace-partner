import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Fingerprint, Copy, Check } from "lucide-react";

// ----------------------------------------------------------------------------
// Identifiers.
//
// These ids come up constantly when doing anything directly against the
// database — writing a migration, running a diagnostic query, copying data
// between athletes. Without this the only way to find an athlete id is to run
// a SELECT against the athletes table, which is a poor experience for the one
// piece of information you need BEFORE you can run anything else.
//
// Not sensitive: a UUID is an identifier, not a credential. Athlete ids
// already appear in page URLs, and every table is protected by RLS keyed on
// auth.uid() — knowing an id grants nothing on its own. Wrapping these in
// warnings would imply a security property they don't have.
//
// Shared rather than duplicated: this appears on both the Account page (your
// own ids) and the athlete detail page (a coach looking at one of their
// athletes). Two hand-maintained copies would drift.
// ----------------------------------------------------------------------------

export function CopyableId({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null | undefined;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // Reverts on its own — long enough to register, short enough that a
      // second copy still gives feedback.
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard API is unavailable over plain http and in some embedded
      // webviews. Say so rather than silently doing nothing.
      toast.error("Couldn't copy — select the text and copy manually");
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        {value && (
          <button
            type="button"
            onClick={copy}
            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {/* select-all so a triple-click grabs the whole UUID cleanly rather
          than stopping at a hyphen. */}
      <code className="block text-[11px] font-mono bg-muted rounded px-2 py-1.5 break-all select-all">
        {value ?? "—"}
      </code>
      {hint && <p className="text-[10px] text-muted-foreground leading-snug">{hint}</p>}
    </div>
  );
}

/**
 * Collapsible Identifiers card. Collapsed by default — most people will never
 * need this, and a profile page shouldn't lead with database internals.
 */
export function IdentifiersCard({
  athleteId,
  athleteName,
  userId,
  variant = "athlete",
}: {
  athleteId?: string | null;
  athleteName?: string | null;
  /** Only shown on the account variant — a coach viewing an athlete has no
   *  business seeing that athlete's login id, and doesn't need it. */
  userId?: string | null;
  variant?: "account" | "athlete";
}) {
  const [open, setOpen] = useState(false);
  const isAccount = variant === "account";

  return (
    <Card>
      <CardHeader className="pb-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-left w-full">
          <CardTitle className="text-base flex items-center gap-2">
            <Fingerprint className="h-4 w-4" />
            Identifiers
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">{open ? "Hide" : "Show"}</span>
          </CardTitle>
          <CardDescription>
            {isAccount
              ? "The ids that identify this account and athlete profile in the database. Useful for support, or when running a query directly."
              : "This athlete's database id — useful for support requests, or when running a query directly."}
          </CardDescription>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {isAccount && (
            <CopyableId
              label="User ID"
              value={userId}
              hint="Your login. This is what auth.uid() returns, and what user_roles and coach_athletes are keyed on."
            />
          )}
          <CopyableId
            label="Athlete ID"
            value={athleteId}
            hint={
              athleteId
                ? "Sessions, gear, performances and zones all hang off this."
                : isAccount
                  ? "No athlete profile is linked to this login, so there's no athlete id."
                  : "No athlete id available."
            }
          />
          {athleteName && (
            <div className="text-[11px] text-muted-foreground">
              Athlete profile: <span className="font-medium text-foreground">{athleteName}</span>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground leading-snug border-t pt-2">
            These are identifiers, not passwords — they appear in page URLs already, and access to any data is
            controlled separately by the database's own rules. Safe to paste into a support request.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
