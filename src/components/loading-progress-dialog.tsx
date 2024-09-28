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
}

export const LoadingProgressDialog: React.FC<LoadingProgressDialogProps> = ({
  isOpen,
}) => {
  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reading Memory Card</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription asChild>
          <div>
            <div className="mb-2">
              Please wait while we read your memory card...
            </div>
            <Progress className="w-full" />
            <div className="mt-2 text-right">In progress...</div>
          </div>
        </AlertDialogDescription>
      </AlertDialogContent>
    </AlertDialog>
  );
};
