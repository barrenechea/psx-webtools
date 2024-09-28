import React, { createContext, ReactNode,useContext, useState } from "react";

import { LoadingProgressDialog } from "@/components/loading-progress-dialog";

interface LoadingDialogContextType {
  showDialog: (title: string, status: string, additionalInfo?: string) => void;
  updateDialog: (status: string, additionalInfo?: string) => void;
  hideDialog: () => void;
}

const LoadingDialogContext = createContext<
  LoadingDialogContextType | undefined
>(undefined);

export const useLoadingDialog = () => {
  const context = useContext(LoadingDialogContext);
  if (context === undefined) {
    throw new Error(
      "useLoadingDialog must be used within a LoadingDialogProvider"
    );
  }
  return context;
};

export const LoadingDialogProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState<string | undefined>(
    undefined
  );

  const showDialog = (
    newTitle: string,
    newStatus: string,
    newAdditionalInfo?: string
  ) => {
    setTitle(newTitle);
    setStatus(newStatus);
    setAdditionalInfo(newAdditionalInfo);
    setIsOpen(true);
  };

  const updateDialog = (newStatus: string, newAdditionalInfo?: string) => {
    setStatus(newStatus);
    setAdditionalInfo(newAdditionalInfo);
  };

  const hideDialog = () => {
    setIsOpen(false);
  };

  return (
    <LoadingDialogContext.Provider
      value={{ showDialog, updateDialog, hideDialog }}
    >
      {children}
      <LoadingProgressDialog
        isOpen={isOpen}
        title={title}
        status={status}
        additionalInfo={additionalInfo}
      />
    </LoadingDialogContext.Provider>
  );
};
