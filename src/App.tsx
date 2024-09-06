import { ThemeProvider } from "next-themes";

import { EXELoader } from "./components/exe-loader";
import { Header } from "./components/header";
import { LogsProvider } from "./contexts/logs-context";
import { SerialProvider } from "./contexts/serial-context";

const App = () => {
  return (
    <ThemeProvider attribute="class" defaultTheme="light">
      <LogsProvider>
        <SerialProvider>
          <div className="min-h-screen">
            <Header />
            <main className="mx-auto mt-8 max-w-4xl p-6">
              <EXELoader />
            </main>
          </div>
        </SerialProvider>
      </LogsProvider>
    </ThemeProvider>
  );
};

export default App;
