"use client";

import { MergeIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { mergeVendorsAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function MergeVendorDialog({
  vendorId,
  vendorName,
  others,
}: {
  vendorId: string;
  vendorName: string;
  others: Array<{ id: string; name: string }>;
}) {
  const [target, setTarget] = useState<string>("");
  const [pending, start] = useTransition();
  const targetName = others.find((o) => o.id === target)?.name;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MergeIcon />
          Merge into…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge {vendorName} into another vendor</DialogTitle>
          <DialogDescription>
            All of {vendorName}&apos;s documents and name variants move to the vendor you pick, and {vendorName} is
            removed. Future uploads under either name will match the merged vendor.
          </DialogDescription>
        </DialogHeader>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="w-full" aria-label="Merge into">
            <SelectValue placeholder="Pick the vendor to keep" />
          </SelectTrigger>
          <SelectContent>
            {others.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            disabled={!target || pending}
            onClick={() =>
              start(async () => {
                const result = await mergeVendorsAction(vendorId, target);
                // On success the action redirects to the merged vendor.
                if (result && !result.ok) toast.error(result.error);
              })
            }
          >
            {pending ? "Merging…" : targetName ? `Merge into ${targetName}` : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
