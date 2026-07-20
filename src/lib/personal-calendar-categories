import { Briefcase, Stethoscope, User, MoreHorizontal } from "lucide-react";

export type PersonalEntryCategory = "work_shift" | "appointment" | "personal" | "other";

export const PERSONAL_CATEGORY_META: Record<PersonalEntryCategory, { label: string; icon: any; colorCls: string; dotCls: string }> = {
  work_shift: {
    label: "Work shift",
    icon: Briefcase,
    colorCls: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    dotCls: "bg-blue-500",
  },
  appointment: {
    label: "Appointment",
    icon: Stethoscope,
    colorCls: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    dotCls: "bg-orange-500",
  },
  personal: {
    label: "Personal",
    icon: User,
    colorCls: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    dotCls: "bg-violet-500",
  },
  other: {
    label: "Other",
    icon: MoreHorizontal,
    colorCls: "bg-gray-500/15 text-gray-400 border-gray-500/30",
    dotCls: "bg-gray-500",
  },
};

export const PERSONAL_CATEGORY_OPTIONS = Object.entries(PERSONAL_CATEGORY_META).map(([value, meta]) => ({
  value: value as PersonalEntryCategory,
  label: meta.label,
}));
