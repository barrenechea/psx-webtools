import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface LoadingProgressDialogProps {
  isOpen: boolean;
  title: string;
  status: string;
  additionalInfo?: string;
  progress?: number; // New prop for progress value
}

export const LoadingProgressDialog: React.FC<LoadingProgressDialogProps> = ({
  isOpen,
  title,
  status,
  additionalInfo,
  progress,
}) => {
  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription
          render={(props) => (
            <div {...props}>
              <div
                className={cn(
                  (progress !== undefined || additionalInfo) && "mb-2",
                )}
              >
                {status}
              </div>
              {progress !== undefined && (
                <Progress
                  className="w-full **:data-[slot=progress-indicator]:transition-none"
                  value={progress * 100}
                />
              )}
              {additionalInfo && (
                <div className="mt-2 text-right">{additionalInfo}</div>
              )}
            </div>
          )}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
};
