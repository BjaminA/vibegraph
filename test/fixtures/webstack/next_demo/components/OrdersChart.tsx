import { refund } from "@/lib/volt";
import { Badge } from "@/components/Badge";

export function OrdersChart({ rows }: { rows: unknown[] }) {
  return <div onClick={() => refund("r-1")}><Badge hot={rows.length > 9} />{rows.length} orders</div>;
}
