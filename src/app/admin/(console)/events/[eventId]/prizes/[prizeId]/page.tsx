import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/server/request-context";
import { listCategories } from "@/modules/prizes/server/categories";
import { getPrize } from "@/modules/prizes/server/prizes";
import { updatePrizeAction } from "../actions";
import { PrizeForm } from "../prize-form";
import { PrizePhoto, PrizeStatusAndDelete } from "./prize-controls";

export const metadata: Metadata = { title: "Prize" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function PrizePage({ params }: PageProps<"/admin/events/[eventId]/prizes/[prizeId]">) {
  await requireAdmin();
  const { eventId, prizeId } = await params;
  if (!UUID.test(prizeId)) notFound();
  const database = db();
  const [prize, categories] = await Promise.all([getPrize(database, eventId, prizeId), listCategories(database, eventId)]);
  if (!prize) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <Link href={`/admin/events/${eventId}/prizes`} className="text-sm text-muted-foreground hover:underline">
          ← Prizes
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{prize.name}</h1>
        <p className="font-mono text-xs text-muted-foreground">
          {prize.code} · drawn #{prize.drawOrder}
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <PrizeForm
          action={updatePrizeAction.bind(null, eventId, prizeId)}
          categories={categories}
          submitLabel="Save changes"
          initial={{
            code: prize.code,
            name: prize.name,
            description: prize.description ?? "",
            quantity: String(prize.quantity),
            categoryId: prize.categoryId ?? "",
          }}
        />
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Photo</CardTitle>
            </CardHeader>
            <CardContent>
              <PrizePhoto key={prize.photoId ?? "none"} eventId={eventId} prizeId={prizeId} photoId={prize.photoId} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Draw status</CardTitle>
            </CardHeader>
            <CardContent>
              <PrizeStatusAndDelete key={prize.status} eventId={eventId} prizeId={prizeId} available={prize.status === "AVAILABLE"} drawn={prize._count.draws > 0} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
