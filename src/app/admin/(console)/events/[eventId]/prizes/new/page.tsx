import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { listCategories } from "@/modules/prizes/server/categories";
import { createPrizeAction } from "../actions";
import { PrizeForm } from "../prize-form";

export const metadata: Metadata = { title: "New prize" };

export default async function NewPrizePage({ params }: PageProps<"/admin/events/[eventId]/prizes/new">) {
  await requireAdmin();
  const { eventId } = await params;
  const categories = await listCategories(db(), eventId);
  return (
    <div className="grid gap-5">
      <div>
        <Link href={`/admin/events/${eventId}/prizes`} className="text-sm text-muted-foreground hover:underline">
          ← Prizes
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Add prize</h1>
        <p className="text-sm text-muted-foreground">New prizes are drawn last. Change the order from the prize list.</p>
      </div>
      <PrizeForm
        action={createPrizeAction.bind(null, eventId)}
        categories={categories}
        submitLabel="Add prize"
        initial={{ code: "", name: "", description: "", quantity: "1", categoryId: "" }}
      />
    </div>
  );
}
