import { createRootRoute, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { Sidebar } from "@/components/sidebar";

const ReactQueryDevtools = import.meta.env.PROD
  ? () => null // Render nothing in production
  : lazy(() =>
      // Lazy load in development
      import("@tanstack/react-query-devtools").then((res) => ({
        default: res.ReactQueryDevtools,
      }))
    );

const TanStackRouterDevtools = import.meta.env.PROD
  ? () => null // Render nothing in production
  : lazy(() =>
      // Lazy load in development
      import("@tanstack/router-devtools").then((res) => ({
        default: res.TanStackRouterDevtools,
      }))
    );

export const Route = createRootRoute({
  component: () => (
    <>
      <div className="flex w-full flex-row">
        <Sidebar />
        <div className="relative flex-1">
          <div className="absolute inset-0 animate-background-shine bg-gradient-shine bg-400% dark:bg-gradient-shine-dark" />
          <div className="relative z-10 h-full overflow-auto">
            <Outlet />
          </div>
        </div>
      </div>
      <Suspense>
      <ReactQueryDevtools />
      <TanStackRouterDevtools />
      </Suspense>
    </>
  ),
});
