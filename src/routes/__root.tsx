import { createRootRoute, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";

import { Sidebar } from "@/components/sidebar";

export const Route = createRootRoute({
  component: () => (
    <>
      <Sidebar />
      <Outlet />
      <TanStackRouterDevtools />
    </>
  ),
});
