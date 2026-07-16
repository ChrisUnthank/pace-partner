import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Users, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/reports/")({
  component: ReportsHub,
});

function ReportsHub() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-[var(--accent-red)]" />
          <h1 className="text-2xl font-bold">Reports</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Generate on demand. Every number is compiled straight from recorded training data — nothing here is
          AI-written. Print to PDF or email once generated.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <Link to="/app/reports/athlete-weekly">
            <Card className="hover:bg-accent/40 transition h-full">
              <CardHeader>
                <FileText className="h-5 w-5 text-[var(--accent-red)] mb-1" />
                <CardTitle className="text-base">Athlete Weekly Report</CardTitle>
                <CardDescription>
                  Distance, load, zones, sessions, and PBs for one athlete's week.
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Card className="opacity-60 h-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <Users className="h-5 w-5 text-muted-foreground mb-1" />
                <Badge variant="outline" className="text-[10px]">Coming soon</Badge>
              </div>
              <CardTitle className="text-base">Coach Weekly Summary</CardTitle>
              <CardDescription>Roster-wide view: volume, completion, and flags across every athlete.</CardDescription>
            </CardHeader>
          </Card>

          <Card className="opacity-60 h-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <ClipboardList className="h-5 w-5 text-muted-foreground mb-1" />
                <Badge variant="outline" className="text-[10px]">Coming soon</Badge>
              </div>
              <CardTitle className="text-base">Training Plan Report</CardTitle>
              <CardDescription>Planned vs. actual for an assigned plan — weekly, monthly, or by block.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
