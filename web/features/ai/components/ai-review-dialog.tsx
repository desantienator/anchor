"use client";

import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Tag } from "@/features/tags";
import { AiReview } from "./ai-review";

interface AiReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  version: number;
  content: string;
  title: string;
  tagIds: string[];
  allTags: Tag[];
  /** Viewers may take tag suggestions but cannot change the text. */
  canEditText: boolean;
  flushEdits: () => Promise<void>;
  onApplyTags: (next: string[]) => void;
  onApplyContent: (next: string) => void;
}

export function AiReviewDialog({
  open,
  onOpenChange,
  ...props
}: AiReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="default" className="max-w-140">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4" />
            Local AI suggestions
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          {open && <AiReview {...props} onClose={() => onOpenChange(false)} />}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
