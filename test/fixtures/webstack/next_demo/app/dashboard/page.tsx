import { OrdersChart } from "@/components/OrdersChart";
import { ExportButton } from "@/components/ExportButton";
import Chart from "@/components/RegionChart";
import { listOrders } from "@/lib/db";
import { balance } from "@/lib/ledger";
// An alias whose target is NOT in the IR (a CSS module): still this
// project's own path, never a dependency.
import "@/styles/dashboard.module.css";

/** The operator dashboard. */
export default async function DashboardPage() {
  const rows = await listOrders("all");
  const owed = await balance("operator");
  return (
    <section>
      <OrdersChart rows={rows} owed={owed} />
      <ExportButton region="all" />
      <Chart region="all" />
    </section>
  );
}
