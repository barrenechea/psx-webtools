import { ThemeProvider } from "next-themes";

import { EXELoader } from "./components/exe-loader";
import { MemCARDuinoReader } from "./components/memcarduino";
import { Sidebar } from "./components/sidebar";
import { LogsProvider } from "./contexts/logs-context";
import { SerialProvider } from "./contexts/serial-context";

const App = () => {
  return (
    <ThemeProvider attribute="class" defaultTheme="light">
      <LogsProvider>
        <SerialProvider>
          <div className="min-h-screen">
            <Sidebar />
            <main className="mx-auto mt-8 max-w-4xl space-y-8 p-6">
              <EXELoader />
              <MemCARDuinoReader />
            </main>
          </div>
        </SerialProvider>
      </LogsProvider>
    </ThemeProvider>
  );
};

export default App;
