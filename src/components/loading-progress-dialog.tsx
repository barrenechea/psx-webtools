import React from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";

interface LoadingProgressDialogProps {
  isOpen: boolean;
  title: string;
  status: string;
  additionalInfo?: string;
}

export const LoadingProgressDialog: React.FC<LoadingProgressDialogProps> = ({
  isOpen,
  title,
  status,
  additionalInfo,
}) => {
  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription asChild>
          <div>
            <div className="mb-2">{status}</div>
            <Progress className="w-full" />
            {additionalInfo && (
              <div className="mt-2 text-right">{additionalInfo}</div>
            )}
          </div>
        </AlertDialogDescription>
      </AlertDialogContent>
    </AlertDialog>
  );
};
