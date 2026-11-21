import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "Draft", variant: "outline" },
  FROZEN: { label: "Frozen", variant: "default" },
  DRAWING: { label: "Drawing", variant: "default" },
  COMPLETED: { label: "Completed", variant: "secondary" },
  CANCELLED: { label: "Cancelled", variant: "outline" },
  SUPERSEDED: { label: "Superseded", variant: "outline" },
};

export function PreparationStatusBadge({ status }: { status: string }) {
  const entry = LABELS[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
