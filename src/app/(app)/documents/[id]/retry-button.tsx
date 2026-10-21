"use client";

import { RotateCcwIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { retryExtractionAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";

export function RetryButton({ documentId, label = "Re-extract" }: { documentId: string; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await retryExtractionAction(documentId);
          if (result.ok) toast.success("Extraction restarted");
          else toast.error(result.error);
        })
      }
    >
      <RotateCcwIcon />
      {label}
    </Button>
  );
}
