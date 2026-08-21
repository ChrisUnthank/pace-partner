import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMyRoles, useAuthUser, useCoachRoster } from "@/lib/use-auth";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Users, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PLAN_INCLUSIONS,
  PLAN_INCLUSION_GROUP_LABEL,
  inclusionLabels,
  type PlanInclusion,
} from "@/lib/coaching-plan-inclusions";

export const Route = createFileRoute("/_authenticated/app/manage-athletes")({
  component: ManageAthletesPage,
});

// ----------------------------------------------------------------------------
// Squad admin — who the athlete is, when they can train, what they pay.
//
// Distinct from the "Manage athletes" dialog on Training Schedule, which
// assigns athletes to training GROUPS. That one answers "who trains together";
// this answers "who is this person". The overlap in the old name was the whole
// problem.
//
// Deliberately holds nothing about training or performance. Session notes
// belong on sessions and observations in the coach diary, where they are dated
// and searchable — an undated free-text blob on the athlete would become the
// place things go to be lost.
//
// It also does NOT feed the Address Book. The Address Book already derives its
// contents from athletes, parent_athlete_links and person_contact_details, so
// editing here updates it for free. A second store that pushed to it would be
// two copies of one truth.
// ----------------------------------------------------------------------------

const DAYS: { n: number; label: string }[] = [
  // Mon=1..Sun=7, matching dayOfWeek() in campaign-generator.ts.
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
];

const FEE_PERIODS = ["session", "weekly", "fortnightly", "monthly", "term", "annual"];

function ManageAthletesPage() {
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const { data: roster = [] } = useCoachRoster();
  const [openId, setOpenId] = useState<string | null>(null);

  const athletes = [...(roster ?? [])]
    .map((r: any) => r.athletes)
    .filter(Boolean)
    .sort((a: any, b: any) => (a.name ?? "").localeCompare(b.name ?? ""));

  if (!isCoach) {
    return (
      <AppShell fullWidth>
        <p className="text-sm text-muted-foreground">This page is for coaches.</p>
      </AppShell>
    );
  }

  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-4xl">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-[var(--accent-red)]/10 grid place-items-center shrink-0">
            <Users className="h-5 w-5 text-[var(--accent-red)]" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Squad admin
            </div>
            <h1 className="text-2xl font-bold">Manage Athletes</h1>
          </div>
        </div>

        <CoachingPlansCard />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Athletes</CardTitle>
            <CardDescription>
              Contact and administrative details. Training groups are set on Training Schedule; session notes belong on
              the session itself.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {athletes.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No athletes on your roster yet.</p>
            ) : (
              <div className="divide-y">
                {athletes.map((a: any) => (
                  <div key={a.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(openId === a.id ? null : a.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40"
                    >
                      <UserAvatar name={a.name ?? ""} imageUrl={a.profile_image_url} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{a.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {[a.club, a.school, a.primary_event].filter(Boolean).join(" · ") || "No details recorded"}
                        </div>
                      </div>
                      {a.athlete_status && a.athlete_status !== "active" && (
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {a.athlete_status}
                        </Badge>
                      )}
                      {openId === a.id ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                    {openId === a.id && <AthleteAdminPanel athlete={a} />}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

// ----------------------------------------------------------------------------

function CoachingPlansCard() {
  const qc = useQueryClient();
  const { user } = useAuthUser();
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const { data: plans = [] } = useQuery({
    queryKey: ["coaching-plans", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("coaching_plans")
        .select("*")
        .eq("coach_user_id", user!.id)
        .order("name");
      return data ?? [];
    },
  });

  async function retire(id: string, active: boolean) {
    // Retired, not deleted — athletes already on it keep a readable record of
    // what they were on. The foreign key is ON DELETE SET NULL, so deleting
    // would quietly detach them.
    await (supabase as any).from("coaching_plans").update({ active: !active }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["coaching-plans", user?.id] });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Coaching plans</CardTitle>
            <CardDescription>
              Named fee arrangements and what they include. Assign one per athlete, and override the amount on the
              athlete where an individual arrangement differs.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditing(editing === "new" ? null : "new")}>
            <Plus className="h-4 w-4 mr-1" /> {editing === "new" ? "Cancel" : "New plan"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing === "new" && (
          <PlanForm coachId={user!.id} onDone={() => setEditing(null)} />
        )}

        {plans.length === 0 && editing !== "new" ? (
          <p className="text-sm text-muted-foreground">
            No plans yet. Add one and it becomes selectable on each athlete below.
          </p>
        ) : (
          <div className="space-y-2">
            {(plans as any[]).map((p) =>
              editing === p.id ? (
                <PlanForm key={p.id} coachId={user!.id} plan={p} onDone={() => setEditing(null)} />
              ) : (
                <div key={p.id} className="border rounded-md px-3 py-2 space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <span className={cn("font-medium", !p.active && "text-muted-foreground line-through")}>
                        {p.name}
                      </span>
                      <span className="text-muted-foreground ml-2">
                        {p.fee_amount != null
                          ? `${p.fee_currency} ${Number(p.fee_amount).toFixed(2)} / ${p.fee_period}`
                          : "No fee set"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Editing was missing entirely — a plan could only be
                          created or retired, so a typo in the name meant
                          retiring it and starting again, leaving a struck-through
                          mistake in the list forever. */}
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(p.id)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => retire(p.id, p.active)}>
                        {p.active ? "Retire" : "Reinstate"}
                      </Button>
                    </div>
                  </div>
                  {inclusionLabels(p.inclusions).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {inclusionLabels(p.inclusions).map((l) => (
                        <Badge key={l} variant="secondary" className="text-[10px] font-normal">
                          {l}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {p.description && <p className="text-[11px] text-muted-foreground">{p.description}</p>}
                </div>
              ),
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One form for creating and editing, rather than two that drift.
 *
 * The add form and an edit form would inevitably diverge — the campaign
 * settings panel in this codebase already did exactly that, with the edit
 * dialog silently writing defaults over settings it never rendered.
 */
function PlanForm({ coachId, plan, onDone }: { coachId: string; plan?: any; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [amount, setAmount] = useState(plan?.fee_amount != null ? String(plan.fee_amount) : "");
  const [period, setPeriod] = useState(plan?.fee_period ?? "monthly");
  const [inclusions, setInclusions] = useState<string[]>(plan?.inclusions ?? []);
  const [saving, setSaving] = useState(false);

  function toggle(key: string) {
    setInclusions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Give the plan a name");
      return;
    }
    setSaving(true);
    const row = {
      name: name.trim(),
      description: description.trim() || null,
      fee_amount: amount.trim() === "" ? null : Number(amount),
      fee_period: period,
      inclusions,
      updated_at: new Date().toISOString(),
    };

    const { error } = plan
      ? await (supabase as any).from("coaching_plans").update(row).eq("id", plan.id)
      : await (supabase as any).from("coaching_plans").insert({ ...row, coach_user_id: coachId });
    setSaving(false);

    if (error) {
      // Plan names are unique per coach, so renaming onto an existing one
      // fails on the index. Said in plain terms rather than as a constraint
      // violation.
      toast.error(
        error.code === "23505" ? `You already have a plan called "${name.trim()}"` : error.message,
      );
      return;
    }
    toast.success(plan ? "Plan updated" : "Plan added");
    qc.invalidateQueries({ queryKey: ["coaching-plans", coachId] });
    onDone();
  }

  const groups: PlanInclusion["group"][] = ["training", "access", "racing"];

  return (
    <div className="border rounded-md p-3 space-y-3 bg-muted/20">
      <div className="grid sm:grid-cols-[1fr_7rem_9rem] gap-2">
        <div>
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Squad" className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Amount</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Per</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FEE_PERIODS.map((p) => (
                <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-xs">Includes</Label>
        <div className="grid sm:grid-cols-3 gap-3 mt-1">
          {groups.map((g) => (
            <div key={g} className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {PLAN_INCLUSION_GROUP_LABEL[g]}
              </div>
              {PLAN_INCLUSIONS.filter((i) => i.group === g).map((i) => (
                <label key={i.key} className="flex items-start gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inclusions.includes(i.key)}
                    onChange={() => toggle(i.key)}
                    className="mt-0.5"
                  />
                  <span>{i.label}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-xs">Description (optional)</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="text-sm"
          placeholder="Anything the tick boxes do not cover"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-8" onClick={onDone}>Cancel</Button>
        <Button size="sm" className="h-8" disabled={saving} onClick={save}>
          {saving ? "Saving…" : plan ? "Save changes" : "Add plan"}
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------

function AthleteAdminPanel({ athlete }: { athlete: any }) {
  const qc = useQueryClient();
  const { user } = useAuthUser();
  const [saving, setSaving] = useState(false);

  const [club, setClub] = useState(athlete.club ?? "");
  const [school, setSchool] = useState(athlete.school ?? "");
  const [status, setStatus] = useState(athlete.athlete_status ?? "active");
  const [planId, setPlanId] = useState<string>(athlete.coaching_plan_id ?? "none");
  const [feeOverride, setFeeOverride] = useState(
    athlete.fee_amount_override != null ? String(athlete.fee_amount_override) : "",
  );
  const [availNotes, setAvailNotes] = useState(athlete.availability_notes ?? "");
  const [adminNotes, setAdminNotes] = useState(athlete.admin_notes ?? "");

  const { data: plans = [] } = useQuery({
    queryKey: ["coaching-plans", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("coaching_plans")
        .select("*")
        .eq("coach_user_id", user!.id)
        .order("name");
      return data ?? [];
    },
  });

  const { data: availability = [] } = useQuery({
    queryKey: ["athlete-availability", athlete.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("athlete_availability")
        .select("*")
        .eq("athlete_id", athlete.id)
        .order("day_of_week");
      return data ?? [];
    },
  });

  const byDay = new Map<number, any>((availability as any[]).map((r) => [r.day_of_week, r]));

  async function toggleDay(day: number) {
    const existing = byDay.get(day);
    if (existing) {
      // Removing the row IS the "unavailable" state — there is no false row,
      // so no way for the two to disagree.
      await (supabase as any).from("athlete_availability").delete().eq("id", existing.id);
    } else {
      await (supabase as any)
        .from("athlete_availability")
        .insert({ athlete_id: athlete.id, day_of_week: day });
    }
    qc.invalidateQueries({ queryKey: ["athlete-availability", athlete.id] });
  }

  async function saveDayNote(day: number, note: string) {
    const existing = byDay.get(day);
    if (!existing) return;
    await (supabase as any)
      .from("athlete_availability")
      .update({ note: note.trim() === "" ? null : note.trim(), updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    qc.invalidateQueries({ queryKey: ["athlete-availability", athlete.id] });
  }

  async function save() {
    setSaving(true);
    const { error } = await (supabase as any)
      .from("athletes")
      .update({
        club: club.trim() || null,
        school: school.trim() || null,
        athlete_status: status,
        coaching_plan_id: planId === "none" ? null : planId,
        // Blank means "use the plan's amount", so it must save as NULL rather
        // than 0 — a zero would read as a genuine free arrangement.
        fee_amount_override: feeOverride.trim() === "" ? null : Number(feeOverride),
        availability_notes: availNotes.trim() || null,
        admin_notes: adminNotes.trim() || null,
      })
      .eq("id", athlete.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["coach-roster"] });
  }

  const selectedPlan = (plans as any[]).find((p) => p.id === planId);
  const effectiveFee =
    feeOverride.trim() !== ""
      ? `${selectedPlan?.fee_currency ?? "AUD"} ${Number(feeOverride).toFixed(2)} (individual)`
      : selectedPlan?.fee_amount != null
        ? `${selectedPlan.fee_currency} ${Number(selectedPlan.fee_amount).toFixed(2)} / ${selectedPlan.fee_period}`
        : "No fee set";

  return (
    <div className="px-4 pb-4 space-y-4 bg-muted/20">
      <div className="grid sm:grid-cols-3 gap-3 pt-3">
        <div>
          <Label className="text-xs">Club</Label>
          <Input value={club} onChange={(e) => setClub(e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">School</Label>
          <Input value={school} onChange={(e) => setSchool(e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Availability ------------------------------------------------------ */}
      <div className="space-y-2">
        <Label className="text-xs">Available days</Label>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => {
            const on = byDay.has(d.n);
            return (
              <button
                key={d.n}
                type="button"
                onClick={() => toggleDay(d.n)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  on ? "bg-foreground text-background border-foreground" : "hover:bg-accent",
                )}
              >
                {d.label}
              </button>
            );
          })}
        </div>

        {/* A note per day, not one note for the week — "Tuesday after 6pm" is
            the detail that decides where a session goes, and it is lost the
            moment it has to share a box with everything else. */}
        {DAYS.filter((d) => byDay.has(d.n)).map((d) => (
          <div key={d.n} className="flex items-center gap-2">
            <span className="w-10 text-xs text-muted-foreground">{d.label}</span>
            <Input
              defaultValue={byDay.get(d.n)?.note ?? ""}
              onBlur={(e) => saveDayNote(d.n, e.target.value)}
              placeholder="e.g. after 6pm, only if not working"
              className="h-7 text-xs"
            />
          </div>
        ))}

        <div>
          <Label className="text-xs">General availability notes</Label>
          <Textarea
            value={availNotes}
            onChange={(e) => setAvailNotes(e.target.value)}
            placeholder="Away in January, exam block in June…"
            className="text-sm"
            rows={2}
          />
        </div>
      </div>

      {/* Fees -------------------------------------------------------------- */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Coaching plan</Label>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="No plan" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No plan</SelectItem>
              {(plans as any[]).filter((p) => p.active || p.id === planId).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}{!p.active ? " (retired)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Individual fee (optional)</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={feeOverride}
            onChange={(e) => setFeeOverride(e.target.value)}
            placeholder="Leave blank to use the plan"
            className="h-8 text-sm"
          />
          <p className="text-[11px] text-muted-foreground mt-1">Currently: {effectiveFee}</p>
          {/* What the selected plan covers, shown where the plan is chosen —
              otherwise a coach has to scroll back to the plans card to recall
              whether "Squad" includes one-to-one time. */}
          {selectedPlan && inclusionLabels(selectedPlan.inclusions).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {inclusionLabels(selectedPlan.inclusions).map((l) => (
                <Badge key={l} variant="secondary" className="text-[10px] font-normal">
                  {l}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <Label className="text-xs">Admin notes</Label>
        <Textarea
          value={adminNotes}
          onChange={(e) => setAdminNotes(e.target.value)}
          placeholder="Anything administrative — not training or performance notes, which belong on the session or in the diary."
          className="text-sm"
          rows={2}
        />
      </div>

      <div className="flex justify-end">
        <Button size="sm" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
