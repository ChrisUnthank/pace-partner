import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function initialsOf(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function UserAvatar({
  name,
  imageUrl,
  size = "md",
  className,
}: {
  name?: string | null;
  imageUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizeCls = {
    xs: "h-6 w-6 text-[10px]",
    sm: "h-8 w-8 text-xs",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
    xl: "h-20 w-20 text-base",
  }[size];
  return (
    <Avatar className={cn(sizeCls, className)}>
      {imageUrl && <AvatarImage src={imageUrl} alt={name ?? ""} />}
      <AvatarFallback className="font-semibold">{initialsOf(name)}</AvatarFallback>
    </Avatar>
  );
}