import { createRootRoute, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
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
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar />
        <SidebarInset className="relative min-h-0 overflow-hidden">
          <SidebarTrigger className="absolute top-2 left-2 z-20 md:hidden" />
          <div className="animate-background-shine bg-gradient-shine dark:bg-gradient-shine-dark absolute inset-0 bg-[length:400%] motion-reduce:animate-none" />
          <div className="relative z-10 h-full overflow-auto">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
      <Suspense>
        <ReactQueryDevtools />
        <TanStackRouterDevtools />
      </Suspense>
    </TooltipProvider>
  ),
});
