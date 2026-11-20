import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · PCASCADE admin" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return <div className="flex flex-1 flex-col bg-background text-foreground">{children}</div>;
}
