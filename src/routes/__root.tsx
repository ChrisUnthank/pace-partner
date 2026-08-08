import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/lib/theme";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lovable App" },
      { name: "description", content: "Lovable Generated Project" },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Lovable App" },
      { property: "og:description", content: "Lovable Generated Project" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Manrope:wght@400;500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Pre-paint bootstrap. Runs synchronously, blocking, before
            anything below it renders — the standard no-FOUC technique.
            Does two jobs:

            1. Light/dark class on <html>. The server always renders
               className="dark" above (it has no way to know a client's
               stored preference); this corrects it client-side the instant
               the page loads.
            2. White-label brand colours (primary, secondary, danger) from
               the cache BrandingProvider writes to localStorage. Without
               this the app would paint Strider red for a frame on every
               load and then flip to the coach's colours once the branding
               RPC resolves.

            Theme precedence here MUST match the resolution in
            src/lib/theme.tsx: a FORCED brand theme wins, then the person's
            own stored choice, then the brand's suggested default, then
            dark. The variable lists and the readable-foreground threshold
            must match BRAND_/SECONDARY_/DANGER_*_VARS and
            readableForeground() in src/lib/branding.tsx. Both are
            duplicated here by necessity — this script runs before any
            module has loaded, so it can't import them.

            suppressHydrationWarning on <html> above stops React from
            complaining that this script changed attributes React didn't
            render itself. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
var el=document.documentElement;
var stored=localStorage.getItem("strider:theme");
var b=null;try{b=JSON.parse(localStorage.getItem("strider:brand")||"null")}catch(e){}
var bt=(b&&(b.defaultTheme==="dark"||b.defaultTheme==="light"))?b.defaultTheme:null;
var forced=!!(b&&b.forceTheme&&bt);
var t=forced?bt:((stored==="light"||stored==="dark")?stored:(bt||"dark"));
if(t==="light"){el.classList.remove("dark")}else{el.classList.add("dark")}
function fg(c){var r=parseInt(c.slice(1,3),16),g=parseInt(c.slice(3,5),16),bl=parseInt(c.slice(5,7),16);
return (0.2126*r+0.7152*g+0.0722*bl)>150?"#111111":"#ffffff"}
function set(c,vars,fgvars){if(!c||!/^#[0-9a-fA-F]{6}$/.test(c))return;var f=fg(c);
for(var i=0;i<vars.length;i++){el.style.setProperty(vars[i],c)}
for(var j=0;j<fgvars.length;j++){el.style.setProperty(fgvars[j],f)}}
if(b){
set(b.brandColor,["--accent-red","--primary","--ring","--sidebar-primary","--sidebar-ring","--chart-1"],["--primary-foreground","--sidebar-primary-foreground"]);
set(b.secondaryColor,["--brand-secondary","--chart-2"],["--brand-secondary-foreground"]);
set(b.dangerColor,["--destructive"],["--destructive-foreground"]);
}
}catch(e){}})();`,
          }}
        />
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster richColors />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
