import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  CpuIcon,
  Home,
  MemoryStickIcon,
} from "lucide-react";
import { useState } from "react";

import PSLogo from "@/assets/ps-logo.svg?react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  isExpanded: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon, label, isExpanded }) => (
  <Link
    to={to}
    className={cn(
      "group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
      isExpanded ? "justify-start" : "justify-center"
    )}
    activeProps={{
      className: "bg-accent text-accent-foreground",
    }}
    inactiveProps={{
      className: "hover:bg-accent/50 hover:text-accent-foreground",
    }}
  >
    <span className={cn("flex items-center", isExpanded && "mr-3")}>
      {icon}
    </span>
    {isExpanded && <span>{label}</span>}
  </Link>
);

export const Sidebar: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col transition-all duration-300 ease-in-out",
        "bg-background/80 backdrop-blur-xl",
        "border-r border-border/50",
        isExpanded ? "w-64" : "w-20"
      )}
    >
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center space-x-3">
          <PSLogo className="size-8" />
          {isExpanded && (
            <h1 className="text-lg font-semibold text-foreground">
              PSX WebTools
            </h1>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
          className="rounded-full hover:bg-accent/10"
        >
          {isExpanded ? (
            <ChevronLeft className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </Button>
      </div>

      <Separator className="my-2 opacity-50" />

      <nav className="flex-1 space-y-1 p-2">
        <NavItem
          to="/"
          icon={<Home className="size-5" />}
          label="Home"
          isExpanded={isExpanded}
        />
        <NavItem
          to="/memory-card-manager"
          icon={<MemoryStickIcon className="size-5" />}
          label="Memory Card Manager"
          isExpanded={isExpanded}
        />
        <NavItem
          to="/memcarduino-flasher"
          icon={<CpuIcon className="size-5" />}
          label="MemCARDuino Flasher"
          isExpanded={isExpanded}
        />
      </nav>

      {isExpanded && (
        <>
          <Separator className="mt-2 opacity-50" />

          <div className="p-4 text-center text-xs text-muted-foreground">
            © 2024 Sebastian Barrenechea
          </div>
        </>
      )}
    </aside>
  );
};
