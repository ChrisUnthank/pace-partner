import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Users, ClipboardList, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/reports/")({
  component: ReportsHub,
});

function ReportsHub() {
  return (
    <AppShell fullWidth>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 rounded-lg grid place-items-center"
            style={{ background: "var(--accent-red)" }}
          >
            <FileText className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Metrics</div>
            <h1 className="text-2xl font-bold leading-tight">Reports</h1>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Generate on demand. The Athlete Report and Coach Roster Summary below are compiled straight from recorded
          training data — nothing AI-written in either. AI Review is the one exception: it's clearly labeled and
          uses AI to write a narrative summary, not just compile numbers.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <Link to="/app/reports/athlete/weekly">
            <Card className="hover:bg-accent/40 transition h-full">
              <CardHeader>
                <FileText className="h-5 w-5 text-[var(--accent-red)] mb-1" />
                <CardTitle className="text-base">Athlete Report</CardTitle>
                <CardDescription>
                  Distance, load, zones, sessions, and PBs for one athlete — weekly, monthly, or a custom date range.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link to="/app/reports/coach/weekly">
            <Card className="hover:bg-accent/40 transition h-full">
              <CardHeader>
                <Users className="h-5 w-5 text-[var(--accent-red)] mb-1" />
                <CardTitle className="text-base">Coach Roster Summary</CardTitle>
                <CardDescription>
                  Roster-wide view: volume, completion, and flags across every athlete — weekly, monthly, or a custom
                  date range.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link to="/app/reports/ai-review">
            <Card className="hover:bg-accent/40 transition h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Sparkles className="h-5 w-5 text-[var(--accent-red)] mb-1" />
                  <Badge variant="outline" className="text-[10px]">AI-written</Badge>
                </div>
                <CardTitle className="text-base">AI Review</CardTitle>
                <CardDescription>
                  A written narrative review — one athlete, several at once, or a combined squad summary. Uses AI,
                  unlike the reports above.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Card className="opacity-60 h-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <ClipboardList className="h-5 w-5 text-muted-foreground mb-1" />
                <Badge variant="outline" className="text-[10px]">Coming soon</Badge>
              </div>
              <CardTitle className="text-base">Training Plan Report</CardTitle>
              <CardDescription>
                Planned vs. actual for an assigned plan — weekly, monthly, by training block, or a custom date range.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
