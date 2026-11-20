import { cn } from "@/lib/utils";

export function BrandSymbol({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect x="1" y="3" width="17" height="7" rx="1" fill="var(--hazard)" />
      <rect x="1" y="5.5" width="17" height="2" fill="oklch(0.18 0.01 250)" opacity="0.35" />
      <rect x="7.5" y="12.5" width="17" height="7" rx="1" fill="var(--hazard)" opacity="0.85" />
      <rect x="7.5" y="15" width="17" height="2" fill="oklch(0.18 0.01 250)" opacity="0.35" />
      <rect x="14" y="22" width="17" height="7" rx="1" fill="var(--hazard)" opacity="0.7" />
      <rect x="14" y="24.5" width="17" height="2" fill="oklch(0.18 0.01 250)" opacity="0.35" />
    </svg>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-heading text-lg font-extrabold tracking-[0.14em] uppercase [font-stretch:115%]", className)}>
      <span className="text-hazard">PCAS</span>
      <span>CADE</span>
    </span>
  );
}

export function BrandLockup({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label="PCASCADE">
      <BrandSymbol className={compact ? "size-6" : "size-8"} />
      <BrandWordmark className={compact ? "text-base" : undefined} />
    </span>
  );
}

export const BRAND_TAGLINE = "Every Reveal Builds Excitement.";
export const BRAND_ASSOCIATION = "PCAS — Project Concepts and Administrative Services, Inc.";
