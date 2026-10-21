"use client";

import { CheckCheckIcon } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { confirmAllCleanAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";

export function ConfirmCleanButton({ count }: { count: number }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await confirmAllCleanAction();
          if (result.ok) toast.success(result.message ?? "Confirmed");
          else toast.error(result.error);
        })
      }
    >
      <CheckCheckIcon />
      {pending ? "Confirming…" : `Confirm ${count} clean document${count === 1 ? "" : "s"}`}
    </Button>
  );
}
