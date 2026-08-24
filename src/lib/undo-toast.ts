import { toast } from "@/components/ui/toast";

/**
 * Confirms a soft delete and offers to put it back.
 *
 * Soft deletion is invisible without this — the row lingering in the database
 * is worth nothing to the user unless they can reach it. This is the only
 * thing that makes `deletedAt` a feature rather than a hidden column.
 */
export function toastUndo(title: string, onUndo: () => void) {
  toast.add({
    title,
    actionProps: {
      children: "元に戻す",
      onClick: onUndo,
    },
  });
}
