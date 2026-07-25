import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthUser } from "@/lib/use-auth";
import { CoachAthletePicker } from "@/components/coach-athlete-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Bell, Download, Mail, Megaphone } from "lucide-react";
import { buildPlanDeliveryWorkbook, downloadPlanDeliveryWorkbook, type PlanDeliverySession } from "@/lib/plan-delivery-xlsx";
import { recordPlanDelivery } from "@/lib/plan-delivery.functions";

type EmailStatus = "not_attempted" | "sent" | "failed" | "skipped_no_email";

type RecipientResult = {
  athlete_id: string;
  athlete_name: string;
  has_login: boolean;
  email_to: string | null;
  email_status: EmailStatus;
};

/**
 * Deliver Program — the final step after training is built: post to
 * Noticeboard and/or email each athlete an Excel-style copy of their
 * sessions in the chosen date range. Deliberately decoupled from all 5
 * build methods (template assign, from-scratch, copy history, copy
 * period, and eventually auto) — reachable as its own standalone action
 * so a coach can re-send or notify an old-school athlete at any time,
 * not just right after building something.
 */
export function DeliverProgramDialog({
  open,
  onClose,
  initialAthleteId,
  initialRangeStart,
  initialRangeEnd,
}: {
  open: boolean;
  onClose: () => void;
  initialAthleteId?: string;
  initialRangeStart?: string;
  initialRangeEnd?: string;
}) {
  const { user } = useAuthUser();
  const qc = useQueryClient();

  const [stepUi, setStepUi] = useState<"setup" | "results">("setup");
  const [scopeMode, setScopeMode] = useState<"athlete" | "select" | "group" | "roster">(
    initialAthleteId ? "athlete" : "roster",
  );
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | undefined>(initialAthleteId);
  // Ad-hoc multi-athlete pick — distinct from "group" (a saved Training
  // Group) and from "roster" (everyone) — for a one-off combination of
  // specific athletes that isn't a formal group.
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>(initialAthleteId ? [initialAthleteId] : []);
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(undefined);

  const today = new Date().toISOString().slice(0, 10);
  const weekAhead = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const [rangeStart, setRangeStart] = useState(initialRangeStart ?? today);
  const [rangeEnd, setRangeEnd] = useState(initialRangeEnd ?? weekAhead);

  const [channelInApp, setChannelInApp] = useState(true);
  const [channelNoticeboard, setChannelNoticeboard] = useState(false);
  const [channelEmail, setChannelEmail] = useState(false);
  const [exportDetailLevel, setExportDetailLevel] = useState<"simple" | "detailed" | "both">("both");
  const [noticeboardTitle, setNoticeboardTitle] = useState("New training block posted");
  const [noticeboardBody, setNoticeboardBody] = useState(
    "Your next block of training is up — check your calendar for the full schedule.",
  );

  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<RecipientResult[]>([]);

  const { data: roster } = useQuery({
    queryKey: ["deliver-dialog-roster", user?.id],
    enabled: open && !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("coach_athletes")
        .select("athlete_id, athletes(id, name, user_id, email)")
        .eq("coach_user_id", user!.id);
      return ((data ?? []) as any[]).map((r) => r.athletes).filter(Boolean);
    },
  });

  const { data: groups } = useQuery({
    queryKey: ["deliver-dialog-groups", user?.id],
    enabled: open && !!user,
    queryFn: async () => {
      const { data } = await supabase.from("training_groups").select("*").eq("coach_user_id", user!.id).order("name");
      return data ?? [];
    },
  });

  const { data: groupMemberIds } = useQuery({
    queryKey: ["deliver-dialog-group-members", selectedGroupId],
    enabled: !!selectedGroupId,
    queryFn: async () => {
      const { data } = await supabase
        .from("training_group_members")
        .select("athlete_id")
        .eq("group_id", selectedGroupId!);
      return (data ?? []).map((r: any) => r.athlete_id as string);
    },
  });

  const scopeAthleteIds =
    scopeMode === "athlete"
      ? selectedAthleteId
        ? [selectedAthleteId]
        : []
      : scopeMode === "select"
        ? selectedAthleteIds
        : scopeMode === "roster"
          ? (roster ?? []).map((a: any) => a.id)
          : groupMemberIds ?? [];

  const scopeAthletes = (roster ?? []).filter((a: any) => scopeAthleteIds.includes(a.id));

  const { data: sourceData } = useQuery({
    queryKey: ["deliver-dialog-sessions", scopeAthleteIds.join(","), rangeStart, rangeEnd],
    enabled: open && scopeAthleteIds.length > 0 && !!rangeStart && !!rangeEnd,
    queryFn: async () => {
      const { data: sessions, error } = await supabase
        .from("sessions")
        .select("id, athlete_id, session_date, title, day_type, intent")
        .in("athlete_id", scopeAthleteIds)
        .gte("session_date", rangeStart)
        .lte("session_date", rangeEnd)
        .order("session_date");
      if (error) throw error;

      const sessionIds = (sessions ?? []).map((s: any) => s.id);
      const stepsBySession = new Map<string, any[]>();
      if (sessionIds.length > 0) {
        const { data: allSteps, error: stepsErr } = await supabase
          .from("steps")
          .select("*")
          .in("session_id", sessionIds)
          .order("step_order");
        if (stepsErr) throw stepsErr;
        for (const s of allSteps ?? []) {
          const list = stepsBySession.get(s.session_id) ?? [];
          list.push(s);
          stepsBySession.set(s.session_id, list);
        }
      }
      return { sessions: sessions ?? [], stepsBySession };
    },
  });

  const sessionCount = sourceData?.sessions.length ?? 0;

  function sessionsForAthlete(athleteId: string): PlanDeliverySession[] {
    if (!sourceData) return [];
    return sourceData.sessions
      .filter((s: any) => s.athlete_id === athleteId)
      .map((s: any) => ({
        session_date: s.session_date,
        title: s.title,
        day_type: s.day_type,
        intent: s.intent,
        steps: sourceData.stepsBySession.get(s.id) ?? [],
      }));
  }

  async function send() {
    if (scopeAthletes.length === 0) {
      toast.error(scopeMode === "athlete" ? "Choose an athlete" : "No athletes in that scope");
      return;
    }
    if (!channelInApp && !channelNoticeboard && !channelEmail) {
      toast.error("Choose at least one delivery channel");
      return;
    }

    setSending(true);
    const recipientResults: RecipientResult[] = [];

    try {
      for (const a of scopeAthletes) {
        const hasLogin = !!a.user_id;
        let emailStatus: EmailStatus = "not_attempted";
        let emailTo: string | null = a.email ?? null;

        if (channelEmail) {
          if (!a.email) {
            emailStatus = "skipped_no_email";
          } else {
            try {
              const athleteSessions = sessionsForAthlete(a.id);
              const { base64, filename } = await buildPlanDeliveryWorkbook(
                a.name,
                athleteSessions,
                exportDetailLevel,
                rangeStart,
                rangeEnd,
              );
              const html = `
                <div style="font-family: Arial, sans-serif; color:#111; max-width:640px;">
                  <h2>Your training block is ready</h2>
                  <p>Hi ${a.name},</p>
                  <p>${noticeboardBody}</p>
                  <p>Your full schedule (${rangeStart} – ${rangeEnd}) is attached as an Excel file.</p>
                </div>
              `;
              const { error } = await supabase.functions.invoke("send-plan-delivery-email", {
                body: {
                  to: a.email,
                  subject: `Training block ${rangeStart} – ${rangeEnd}`,
                  html,
                  attachment: { filename, contentBase64: base64 },
                },
              });
              emailStatus = error ? "failed" : "sent";
            } catch {
              emailStatus = "failed";
            }
          }
        }

        recipientResults.push({
          athlete_id: a.id,
          athlete_name: a.name,
          has_login: hasLogin,
          email_to: emailTo,
          email_status: emailStatus,
        });
      }

      const channels: ("noticeboard" | "in_app" | "email")[] = [
        ...(channelInApp ? (["in_app"] as const) : []),
        ...(channelNoticeboard ? (["noticeboard"] as const) : []),
        ...(channelEmail ? (["email"] as const) : []),
      ];

      await recordPlanDelivery({
        data: {
          dateRangeStart: rangeStart,
          dateRangeEnd: rangeEnd,
          summary: `${sessionCount} session${sessionCount === 1 ? "" : "s"} across ${scopeAthletes.length} athlete${scopeAthletes.length === 1 ? "" : "s"}`,
          channels,
          exportDetailLevel,
          noticeboardTitle: channelNoticeboard || channelInApp ? noticeboardTitle : undefined,
          noticeboardBody: channelNoticeboard || channelInApp ? noticeboardBody : undefined,
          recipients: recipientResults.map((r) => ({
            athlete_id: r.athlete_id,
            email_to: r.email_to,
            email_status: r.email_status,
          })),
        },
      });

      setResults(recipientResults);
      setStepUi("results");
      qc.invalidateQueries({ queryKey: ["noticeboard"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  }

  function handleClose() {
    setStepUi("setup");
    setResults([]);
    onClose();
  }

  const emailStatusLabel: Record<EmailStatus, string> = {
    not_attempted: "Not emailed",
    sent: "Emailed",
    failed: "Email failed",
    skipped_no_email: "No email on file",
  };
  const emailStatusCls: Record<EmailStatus, string> = {
    not_attempted: "bg-muted text-muted-foreground border-border",
    sent: "bg-emerald-100 text-emerald-700 border-emerald-200",
    failed: "bg-red-100 text-red-700 border-red-200",
    skipped_no_email: "bg-amber-100 text-amber-800 border-amber-200",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send program update</DialogTitle>
          <DialogDescription>
            {stepUi === "setup"
              ? "Post to Noticeboard and/or email each athlete an Excel copy of their upcoming sessions."
              : "Here's what happened for each recipient."}
          </DialogDescription>
        </DialogHeader>

        {stepUi === "setup" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={scopeMode === "athlete" ? "default" : "outline"} onClick={() => setScopeMode("athlete")}>
                Single athlete
              </Button>
              <Button size="sm" variant={scopeMode === "select" ? "default" : "outline"} onClick={() => setScopeMode("select")}>
                Select athletes
              </Button>
              <Button size="sm" variant={scopeMode === "group" ? "default" : "outline"} onClick={() => setScopeMode("group")}>
                Training group
              </Button>
              <Button size="sm" variant={scopeMode === "roster" ? "default" : "outline"} onClick={() => setScopeMode("roster")}>
                Whole roster
              </Button>
            </div>

            {scopeMode === "athlete" ? (
              <div>
                <Label className="text-xs">Athlete</Label>
                <div className="mt-1">
                  <CoachAthletePicker roster={roster ?? []} value={selectedAthleteId} onChange={setSelectedAthleteId} />
                </div>
              </div>
            ) : scopeMode === "select" ? (
              <div>
                <Label className="text-xs">
                  Athletes {selectedAthleteIds.length > 0 && `(${selectedAthleteIds.length} selected)`}
                </Label>
                <div className="mt-1 max-h-48 overflow-y-auto rounded border divide-y">
                  {(roster ?? []).map((a: any) => {
                    const checked = selectedAthleteIds.includes(a.id);
                    return (
                      <label key={a.id} className="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-accent/40">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          onChange={() =>
                            setSelectedAthleteIds((ids) =>
                              checked ? ids.filter((id) => id !== a.id) : [...ids, a.id],
                            )
                          }
                        />
                        <span>{a.name}</span>
                      </label>
                    );
                  })}
                  {(!roster || roster.length === 0) && (
                    <p className="text-xs text-muted-foreground p-2">No athletes on your roster yet.</p>
                  )}
                </div>
              </div>
            ) : scopeMode === "group" ? (
              <div>
                <Label className="text-xs">Group</Label>
                <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose a group" />
                  </SelectTrigger>
                  <SelectContent>
                    {(groups ?? []).map((g: any) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Through</Label>
                <Input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
              </div>
            </div>

            <div>
              <Label className="text-xs">Channels</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                <Button
                  size="sm"
                  variant={channelInApp ? "default" : "outline"}
                  onClick={() => setChannelInApp((v) => !v)}
                  className="gap-1.5"
                >
                  <Bell className="h-3.5 w-3.5" /> Notify recipients (in-app)
                </Button>
                <Button
                  size="sm"
                  variant={channelNoticeboard ? "default" : "outline"}
                  onClick={() => setChannelNoticeboard((v) => !v)}
                  className="gap-1.5"
                >
                  <Megaphone className="h-3.5 w-3.5" /> Post to Noticeboard (whole squad)
                </Button>
                <Button
                  size="sm"
                  variant={channelEmail ? "default" : "outline"}
                  onClick={() => setChannelEmail((v) => !v)}
                  className="gap-1.5"
                >
                  <Mail className="h-3.5 w-3.5" /> Email Excel export
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                <strong>Notify recipients</strong> only reaches the athletes selected below (via their bell-icon
                notifications and calendar). <strong>Noticeboard</strong> is a separate broadcast to everyone on your
                roster, regardless of who's selected. Use either, both, or neither.
              </p>
            </div>

            {(channelInApp || channelNoticeboard) && (
              <div className="rounded-md border p-3 space-y-2 bg-muted/20">
                {channelNoticeboard && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    This Noticeboard post goes to your entire squad, not just the athletes selected above.
                  </p>
                )}
                <div>
                  <Label className="text-xs">Title</Label>
                  <Input value={noticeboardTitle} onChange={(e) => setNoticeboardTitle(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Message</Label>
                  <Textarea value={noticeboardBody} onChange={(e) => setNoticeboardBody(e.target.value)} rows={2} />
                </div>
              </div>
            )}

            {channelEmail && (
              <div>
                <Label className="text-xs">Excel export detail</Label>
                <Select value={exportDetailLevel} onValueChange={(v: any) => setExportDetailLevel(v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simple">Simple — one row per session</SelectItem>
                    <SelectItem value="detailed">Detailed — one row per step</SelectItem>
                    <SelectItem value="both">Both — two sheets in one file</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {scopeAthletes.length > 0 && (
              <div>
                <Label className="text-xs">
                  Recipients ({scopeAthletes.length}) — {sessionCount} session{sessionCount === 1 ? "" : "s"} in range
                </Label>
                <div className="mt-1.5 space-y-1.5 max-h-56 overflow-y-auto">
                  {scopeAthletes.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{a.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">
                            {a.user_id ? "Has app login" : "No app login"}
                          </Badge>
                          {channelEmail && (
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${a.email ? "" : "bg-amber-100 text-amber-800 border-amber-200"}`}
                            >
                              {a.email ? "Email on file" : "No email — add one to send"}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() =>
                          downloadPlanDeliveryWorkbook(a.name, sessionsForAthlete(a.id), exportDetailLevel, rangeStart, rangeEnd)
                        }
                        title="Download this athlete's Excel export directly"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            {results.map((r) => (
              <div key={r.athlete_id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                <div className="font-medium">{r.athlete_name}</div>
                <div className="flex items-center gap-1.5">
                  {(channelNoticeboard || channelInApp) && r.has_login && (
                    <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                      Notified in app
                    </Badge>
                  )}
                  {channelEmail && (
                    <Badge variant="outline" className={`text-[10px] ${emailStatusCls[r.email_status]}`}>
                      {emailStatusLabel[r.email_status]}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {stepUi === "setup" ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={send} disabled={sending}>
                {sending ? "Sending..." : "Send"}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
