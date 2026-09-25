// A DEFAULT export whose import name differs from the function's name —
// `import Chart from "@/components/RegionChart"` — the dominant Next.js
// idiom, and the shape the linker never bound before M-FLOW.5: the import
// was recorded as a bare `Chart`, so the target was searched for a function
// called Chart. The `export default X;` statement form is used on purpose.
import { listOrders } from "@/lib/db";

function RegionChartView({ region }: { region: string }) {
  const rows = listOrders(region);
  return <ul>{String(rows)}</ul>;
}

export default RegionChartView;
