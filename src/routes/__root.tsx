import { createRootRoute, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { Sidebar } from "@/components/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const ReactQueryDevtools = import.meta.env.PROD
  ? () => null // Render nothing in production
  : lazy(() =>
      // Lazy load in development
      import("@tanstack/react-query-devtools").then((res) => ({
        default: res.ReactQueryDevtools,
      })),
    );

const TanStackRouterDevtools = import.meta.env.PROD
  ? () => null // Render nothing in production
  : lazy(() =>
      // Lazy load in development
      import("@tanstack/react-router-devtools").then((res) => ({
        default: res.TanStackRouterDevtools,
      })),
    );

export const Route = createRootRoute({
  component: () => (
    <TooltipProvider delayDuration={100}>
      <div className="flex h-screen w-full flex-row">
        <Sidebar />
        <div className="relative flex-1">
          <div className="animate-background-shine bg-gradient-shine dark:bg-gradient-shine-dark absolute inset-0 bg-[length:400%]" />
          <div className="relative z-10 h-full overflow-auto">
            <Outlet />
          </div>
        </div>
      </div>
      <Suspense>
        <ReactQueryDevtools />
        <TanStackRouterDevtools />
      </Suspense>
    </TooltipProvider>
  ),
});
