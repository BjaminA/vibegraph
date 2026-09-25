// Wraps `clsx`, a class-name utility no table classifies and NO ONE has
// stated a role for. Imported by OrdersChart, so it would qualify as a
// funnel under any "unknown is wrappable" rule — which is exactly the noise
// that rule produced on a real codebase (clsx ×79). It must stay out.
import clsx from "clsx";

export function Badge({ hot }: { hot: boolean }) {
  return <span className={clsx("badge", hot && "hot")}>!</span>;
}
