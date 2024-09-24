import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";

import { Sidebar } from "@/components/sidebar";

export const Route = createRootRoute({
  component: () => (
    <>
      <div className="flex w-full flex-row">
        <Sidebar />
        <Outlet />
      </div>
      <TanStackRouterDevtools />
    </>
  ),
});
