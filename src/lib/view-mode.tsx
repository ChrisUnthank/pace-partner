import { createContext, useContext, useState, type ReactNode } from "react";
import { useMyRoles } from "@/lib/use-auth";

// "View as Coach / Athlete" — for a user who holds BOTH roles (a coach who
// also trains themselves), every page that branches on role to decide
// WHICH VIEW to render (coach roster vs. self-service athlete view) needs
// a way to know which one the person actually wants to see right now,
// since holding both roles doesn't mean they always want the coach view.
//
// CRITICAL SAFETY NOTE: this is a client-side UI preference, not a
// permission system. It must ONLY be used to decide which view/component
// to render. It must NEVER be used in place of real role checks for
// anything that gates a mutation, an edit affordance, or anything RLS
// already enforces server-side (e.g. `canEdit`, insert/update calls, admin
// actions). Use useMyRoles()/useMyRawRoles() directly for those, always.
// Swapping view mode can never grant access the person's real roles
// don't already allow — it only changes which already-permitted view is
// on screen.

export type ViewMode = "coach" | "athlete";

const LS_KEY = "strider:view-mode";

function readStoredViewMode(): ViewMode {
  if (typeof window === "undefined") return "coach";
  return window.localStorage.getItem(LS_KEY) === "athlete" ? "athlete" : "coach";
}

interface ViewModeContextValue {
  // Only meaningful (and only rendered as a toggle) for a dual-role user.
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  isDualRole: boolean;
  // The two flags every page should actually branch on. Deliberately NOT
  // just "viewMode === 'coach'" — a single-role user's flags must always
  // reflect their real role regardless of viewMode/localStorage, and a
  // user with NEITHER role (e.g. a parent-only account) must get false
  // for both rather than incorrectly defaulting into one.
  isCoachView: boolean;
  isAthleteView: boolean;
}

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const { data: roles = [] } = useMyRoles();
  const isCoach = roles.includes("coach");
  const isAthlete = roles.includes("athlete");
  const isDualRole = isCoach && isAthlete;

  const [stored, setStored] = useState<ViewMode>(readStoredViewMode);

  function setViewMode(mode: ViewMode) {
    setStored(mode);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, mode);
  }

  // Dual-role: follow the toggle, mutually exclusive. Single-role (or no
  // role at all): always the real role, never influenced by a stale
  // stored preference from e.g. a since-removed coach role.
  const isCoachView = isDualRole ? stored === "coach" : isCoach;
  const isAthleteView = isDualRole ? stored === "athlete" : isAthlete;
  const viewMode: ViewMode = isCoachView ? "coach" : "athlete";

  return (
    <ViewModeContext.Provider value={{ viewMode, setViewMode, isDualRole, isCoachView, isAthleteView }}>
      {children}
    </ViewModeContext.Provider>
  );
}

export function useViewMode(): ViewModeContextValue {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error("useViewMode must be used within a ViewModeProvider");
  return ctx;
}

// Convenience alias — most call sites just want the two flags, not the
// setter, so this reads a little cleaner at the call site.
export function useEffectiveRole(): { isCoachView: boolean; isAthleteView: boolean; isDualRole: boolean } {
  const { isCoachView, isAthleteView, isDualRole } = useViewMode();
  return { isCoachView, isAthleteView, isDualRole };
}
