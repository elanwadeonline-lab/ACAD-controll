import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./control.css";
import ControlShell from "./ControlShell";

export const metadata: Metadata = {
  title: "ACAD Supervisory Control Platform",
  description: "Global Fleet Telemetry & Multi-Campus Supervisory Control Plane",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ControlShell>{children}</ControlShell>
      </body>
    </html>
  );
}
