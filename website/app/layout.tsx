import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://boundedagentharness.com"),
  title: "Bounded Agent Harness — Reliable agent workflows",
  description: "A deterministic control plane for bounded, inspectable multi-agent workflows.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
