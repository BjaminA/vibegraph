// Terminal node 1: what the user sees. The page renders this component,
// the component runs a backend script THROUGH the platform client — and
// the literal it hands over is the join to terminal node 2, the script.
import { exportOrders, nightly } from "@/lib/volt";

export function ExportButton({ region }: { region: string }) {
  // An inline handler flattens into the component (the stated inline-callback
  // rule), so the call is on the page's thread. NAMED LIMIT: a handler
  // declared as a nested function and passed by NAME is not walked — it is
  // defined here and called by the framework, and nothing in the IR says so.
  return (
    <div>
      <button onClick={() => exportOrders(region)}>Export {region}</button>
      <button onClick={() => nightly()}>Run nightly rollup</button>
    </div>
  );
}
