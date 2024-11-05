import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface AlphaNoticeDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AlphaNoticeDialog({
  isOpen,
  onClose,
}: AlphaNoticeDialogProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Alpha Version Notice</AlertDialogTitle>
          <AlertDialogDescription className="space-y-4 pt-2">
            <p>
              Welcome to the Memory Card Manager! This feature is currently in
              an early alpha stage, and many features are still under
              development.
            </p>
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4">
              <h4 className="mb-2 font-medium">Limited Functionality Notice</h4>
              <ul className="list-inside list-disc space-y-1 text-sm">
                <li>Copy/Move functionality is currently disabled</li>
                <li>Game save editing features are not implemented yet</li>
                <li>Limited testing with different memory card formats</li>
                <li>Some MemCARDuino features may be unstable</li>
              </ul>
            </div>
            <p className="text-sm text-muted-foreground">
              Please note that this is a work in progress, and we appreciate
              your understanding and feedback as we continue to improve the
              application.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={onClose}>I understand</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
