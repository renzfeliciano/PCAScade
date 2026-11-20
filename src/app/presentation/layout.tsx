import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Presentation", template: "%s · PCASCADE" },
  robots: { index: false, follow: false },
};

export default function PresentationLayout({ children }: LayoutProps<"/presentation">) {
  return <div className="dark flex min-h-dvh flex-1 flex-col overflow-hidden bg-background text-foreground">{children}</div>;
}
