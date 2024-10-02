import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, GithubIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createLazyFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="flex h-screen w-full items-center justify-center p-4">
      <div className="w-full max-w-4xl overflow-hidden rounded-xl shadow-xl">
        <div className="relative">
          <div className="relative z-10 space-y-6 bg-background/80 p-8 backdrop-blur-xl">
            <h1 className="text-4xl font-bold">Welcome to PSX WebTools</h1>

            <p className="text-lg text-muted-foreground">
              PSX WebTools is a modern, web-based toolkit designed to enhance
              your PlayStation 1 gaming experience. The goal is to provide
              easy-to-use tools for different tasks related to PS1 development
              and gaming.
            </p>

            <div className="space-y-4">
              <h2 className="text-2xl font-semibold">Features (for now):</h2>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  Memory Card Manager: View, edit, and organize your PS1 memory
                  card saves. MemCARDuino support included!
                </li>
                <li>
                  Web-based: No installation required, use it directly in your
                  browser
                </li>
              </ul>
            </div>

            <div className="space-y-4">
              <h2 className="text-2xl font-semibold">Get Started:</h2>
              <div className="flex space-x-4">
                <Button asChild>
                  <Link to="/memory-card-manager">
                    Open Memory Card Manager
                    <ArrowRightIcon className="ml-2 size-4" />
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <a
                    href="https://github.com/barrenechea/psx-webtools"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <GithubIcon className="mr-2 size-4" />
                    View on GitHub
                  </a>
                </Button>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              PSX WebTools is an open-source project. Contributions and feedback
              are welcome!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
