import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Home,
} from "lucide-react";
import React, { useState } from "react";

import PSLogo from "@/assets/ps-logo.svg?react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon, label, isActive }) => (
  <Link to={to} className="w-full">
    <Button
      variant="ghost"
      className={cn(
        "w-full justify-start",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent hover:text-accent-foreground"
      )}
    >
      {icon}
      <span className="ml-2">{label}</span>
    </Button>
  </Link>
);

export const Sidebar: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col bg-background/80 backdrop-blur-xl transition-all duration-300 ease-in-out",
        isExpanded ? "w-64" : "w-16"
      )}
    >
      <div className="flex items-center justify-between p-4">
        {isExpanded && (
          <>
            <PSLogo className="mr-2 size-8" />
            <h1 className="text-lg font-semibold">PS1 WebTools</h1>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {isExpanded ? (
            <ChevronLeft className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </Button>
      </div>

      <Separator />

      <nav className="flex-1 space-y-1 p-4">
        <NavItem
          to="/"
          icon={<Home className="size-4" />}
          label="Home"
          isActive={false} // You'll need to implement active state logic
        />
        <NavItem
          to="/exe-loader"
          icon={<FileText className="size-4" />}
          label="EXE Loader"
          isActive={false}
        />
        <NavItem
          to="/memory-card"
          icon={<CreditCard className="size-4" />}
          label="Memory Card"
          isActive={false}
        />
      </nav>

      {isExpanded && (
        <div className="p-4 text-xs text-muted-foreground">
          © 2024 PS1 WebTools
        </div>
      )}
    </aside>
  );
};
