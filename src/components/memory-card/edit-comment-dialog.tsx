import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface EditCommentDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  initialComment: string;
  onSave: (comment: string) => void;
}

export const EditCommentDialog: React.FC<EditCommentDialogProps> = ({
  isOpen,
  onOpenChange,
  initialComment,
  onSave,
}) => {
  const [comment, setComment] = useState(initialComment);

  const handleSave = () => {
    onSave(comment);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Comment</DialogTitle>
          <DialogDescription>
            Comments are only supported by GME files.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Textarea
            value={comment}
            rows={4}
            maxLength={255}
            placeholder="Add a comment for this save..."
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditCommentDialog;
