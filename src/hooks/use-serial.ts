import { useContext } from "react";

import {
  SerialContext,
  type SerialContextType,
} from "@/contexts/serial-context";

export const useSerial = (): SerialContextType => {
  const context = useContext(SerialContext);
  if (context === undefined) {
    throw new Error("useSerial must be used within a SerialProvider");
  }
  return context;
};
