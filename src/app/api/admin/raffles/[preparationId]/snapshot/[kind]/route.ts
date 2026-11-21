import { db } from "@/lib/db";
import { getAdminSession } from "@/modules/auth/server/request-context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KINDS = { participants: "participantsJson", prizes: "prizesJson", rules: "rulesJson" } as const;

export async function GET(_request: Request, { params }: { params: Promise<{ preparationId: string; kind: string }> }) {
  if (!(await getAdminSession())) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { preparationId, kind } = await params;
  if (!UUID.test(preparationId) || !(kind in KINDS)) return new Response(null, { status: 404 });
  const column = KINDS[kind as keyof typeof KINDS];
  const preparation = await db().rafflePreparation.findUnique({ where: { id: preparationId }, select: { version: true, [column]: true } });
  const text = preparation?.[column as keyof typeof preparation];
  if (typeof text !== "string") return new Response(null, { status: 404 });
  return new Response(text, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="raffle-${preparationId.slice(0, 8)}-v${preparation?.version ?? 0}-${kind}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
