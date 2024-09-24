import { Link } from "@tanstack/react-router";

import PSLogo from "@/assets/ps-logo.svg?react";

export const Header: React.FC = () => {
  return (
    <header className="sticky top-0 z-10 border-b p-4">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center space-x-4">
          <PSLogo className="size-8" />
          <h1 className="text-2xl font-bold">PS1 WebTools</h1>
        </div>
        <nav>
          <ul className="flex space-x-4">
            <li>
              <Link to="/" className="text-blue-600 hover:text-blue-800">
                Home
              </Link>
            </li>
            <li>
              <Link
                to="/exe-loader"
                className="text-blue-600 hover:text-blue-800"
              >
                EXE Loader
              </Link>
            </li>
            <li>
              <Link
                to="/memory-card"
                className="text-blue-600 hover:text-blue-800"
              >
                Memory Card Manager
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
};
