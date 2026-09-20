import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "SDR Autopilot — Autonomous GTM Control Plane",
  description:
    "Run multiple autonomous SDR campaigns across email, LinkedIn, SMS and voice, with full human control.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
