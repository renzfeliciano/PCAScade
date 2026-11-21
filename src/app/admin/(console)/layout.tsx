import Link from "next/link";
import { BrandLockup } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/modules/auth/server/request-context";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/participants", label: "Participants" },
  { href: "/admin/prizes", label: "Prizes" },
  { href: "/admin/imports", label: "Imports" },
  { href: "/admin/audit-logs", label: "Audit log" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function ConsoleLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="border-b border-border bg-card md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-4 px-4 py-4 md:flex-col md:items-stretch md:gap-6 md:py-6">
          <Link href="/admin" className="rounded-sm">
            <BrandLockup compact />
          </Link>
          <nav aria-label="Admin" className="flex gap-1 overflow-x-auto md:flex-col">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-secondary hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
          <form method="post" action="/api/admin/session/logout" className="md:mt-auto">
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
