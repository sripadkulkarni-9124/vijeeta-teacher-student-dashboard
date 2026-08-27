import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../../src/app/globals.css";

export const metadata: Metadata = {
  title: "Vijeeta Dashboard Demo",
  description: "Isolated local teacher and student dashboard prototype",
};

export default function FixtureLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
