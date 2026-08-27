import { notFound } from "next/navigation";

import { ConnectedDashboardNavigation } from "@/components/production-dashboard";

export default async function RoleDashboardPage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role } = await params;
  if (role !== "teacher" && role !== "student") notFound();

  // Compatibility entry only; authority resolution replaces this legacy URL
  // with the canonical role route after the server profile has been loaded.
  return <ConnectedDashboardNavigation requestedRoute={role} />;
}
