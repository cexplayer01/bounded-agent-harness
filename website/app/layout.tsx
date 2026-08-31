import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bounded Agent Harness — Reliable agent workflows",
  description: "A deterministic control plane for bounded, inspectable multi-agent workflows.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
