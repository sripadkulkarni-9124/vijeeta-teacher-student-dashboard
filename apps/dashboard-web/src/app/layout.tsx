import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@fontsource-variable/inter/wght.css";

import "./globals.css";

export const metadata: Metadata = {
  title: "Vijeeta Dashboard Demo",
  description: "Isolated local teacher and student dashboard prototype",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
