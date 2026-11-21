import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { buildBundle, publicPreparation } from "@/modules/raffle/server/queries";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_request: Request, context: RouteContext<"/verify/[preparationId]/bundle">) {
  const { preparationId } = await context.params;
  if (!UUID.test(preparationId)) notFound();
  const database = db();
  const visible = await publicPreparation(database, preparationId);
  if (!visible) notFound();
  const bundle = await buildBundle(database, preparationId);
  if (!bundle) notFound();
  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="pcascade-${visible.event.slug}-v${bundle.preparation.version}-bundle.json"`,
      "cache-control": "no-store",
    },
  });
}
