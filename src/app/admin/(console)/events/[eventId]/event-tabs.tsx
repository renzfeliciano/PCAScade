"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { suffix: "", label: "Overview" },
  { suffix: "/participants", label: "Participants" },
  { suffix: "/fields", label: "Custom fields" },
  { suffix: "/prizes", label: "Prizes" },
  { suffix: "/imports", label: "Imports" },
];

export function EventTabs({ eventId, eventName }: { eventId: string; eventName: string }) {
  const pathname = usePathname();
  const base = `/admin/events/${eventId}`;
  return (
    <div className="grid gap-3">
      <Link href="/admin/events" className="text-sm text-muted-foreground hover:underline">
        ← Events
      </Link>
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{eventName}</p>
      <nav aria-label="Event sections" className="flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-border)]">
        {TABS.map((tab) => {
          const href = `${base}${tab.suffix}`;
          const active = tab.suffix === "" ? pathname === base : pathname.startsWith(href);
          return (
            <Link
              key={tab.suffix}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
