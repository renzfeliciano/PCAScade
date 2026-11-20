import { db } from "@/lib/db";
import { getAdminSession } from "@/modules/auth/server/request-context";
import { importIssuesCsv } from "@/modules/imports/server/imports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ eventId: string; batchId: string }> }) {
  if (!(await getAdminSession())) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { eventId, batchId } = await params;
  if (!UUID.test(eventId) || !UUID.test(batchId)) return new Response(null, { status: 404 });
  const csv = await importIssuesCsv(db(), eventId, batchId);
  if (csv === null) return new Response(null, { status: 404 });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="import-${batchId.slice(0, 8)}-problems.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
