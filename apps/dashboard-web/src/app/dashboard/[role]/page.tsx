import { notFound } from "next/navigation";

import { ProductionDashboard } from "@/components/production-dashboard";

export default async function RoleDashboardPage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role } = await params;
  if (role !== "teacher" && role !== "student") notFound();

  // This page is an empty shell. Every profile and V3 data request is
  // authenticated and role-authorized again by the server-side API boundary.
  return <ProductionDashboard />;
}
