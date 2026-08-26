import { Link, useMatchRoute } from "@tanstack/react-router";
import { CpuIcon, Home, MemoryStickIcon } from "lucide-react";
import type { ComponentProps } from "react";

import PSLogo from "@/assets/ps-logo.svg?react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  {
    to: "/memcarduino-flasher",
    icon: CpuIcon,
    label: "MemCARDuino Flasher",
  },
  {
    to: "/memory-card-manager",
    icon: MemoryStickIcon,
    label: "Memory Card Manager",
  },
] as const;

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const matchRoute = useMatchRoute();
  const { setOpenMobile } = useSidebar();
  const copyrightYear = `2024-${new Date().getFullYear()}`;

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="flex-row items-center group-data-[collapsible=icon]:flex-col">
        <SidebarMenu className="flex-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              tooltip="PSX WebTools"
              className="[&_svg]:size-8"
            >
              <Link to="/" onClick={() => setOpenMobile(false)}>
                <PSLogo />
                <span className="truncate font-semibold">PSX WebTools</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarTrigger />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={!!matchRoute({ to: item.to })}
                    tooltip={item.label}
                  >
                    <Link to={item.to} onClick={() => setOpenMobile(false)}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="group-data-[collapsible=icon]:hidden">
        <p className="text-sidebar-foreground/70 px-2 py-1 text-center text-xs">
          © {copyrightYear} Sebastian Barrenechea
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
