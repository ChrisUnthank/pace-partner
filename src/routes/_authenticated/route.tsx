import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ViewModeProvider } from "@/lib/view-mode";
import { BrandingProvider } from "@/lib/branding";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  // BrandingProvider sits INSIDE the auth boundary on purpose — resolving
  // branding needs a signed-in user (it's derived from the coach↔athlete
  // relationship), so there's nothing for it to do on public routes. It
  // depends on ThemeProvider (in __root.tsx) being above it, since it hands
  // the brand's appearance preference down to the theme layer.
  component: () => (
    <ViewModeProvider>
      <BrandingProvider>
        <Outlet />
      </BrandingProvider>
    </ViewModeProvider>
  ),
});
