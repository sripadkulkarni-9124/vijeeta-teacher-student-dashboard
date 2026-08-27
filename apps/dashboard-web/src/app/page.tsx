import { DashboardPrototype } from "@/components/dashboard-prototype";
import { ProductionDashboard } from "@/components/production-dashboard";

export default function HomePage() {
  const production = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_DASHBOARD_MODE === "v3-proxy";
  return production ? <ProductionDashboard /> : <DashboardPrototype />;
}
