import { DashboardPrototype } from "@/components/dashboard-prototype";
import { ProductionDashboard } from "@/components/production-dashboard";

export default function HomePage() {
  return process.env.NEXT_PUBLIC_DASHBOARD_MODE === "v3-proxy" ? <ProductionDashboard /> : <DashboardPrototype />;
}
