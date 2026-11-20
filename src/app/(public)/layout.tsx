import Link from "next/link";
import { BRAND_ASSOCIATION, BrandLockup } from "@/components/brand/brand-mark";

const NAV = [
  { href: "/events", label: "Events" },
  { href: "/about", label: "About" },
];

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="dark flex flex-1 flex-col bg-background text-foreground">
      <div className="hazard-stripe h-1.5" aria-hidden="true" />
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="rounded-sm">
            <BrandLockup />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-6 text-sm font-medium">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-muted-foreground transition-colors hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-6">
          <span>{BRAND_ASSOCIATION}</span>
          <span>Every Reveal Builds Excitement.</span>
        </div>
      </footer>
    </div>
  );
}
