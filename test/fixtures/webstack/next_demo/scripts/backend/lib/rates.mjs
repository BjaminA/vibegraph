// No shebang, no `main`: nothing in this file marks it executable. It is an
// entry point ONLY because scripts/backend/orders/export_orders.sh names it
// (`node "${HERE}/../lib/rates.mjs"`) — the project-level discoverer reads
// that literal and seeds the module (M-FLOW.2).
const region = process.argv[2] ?? "all";
const res = await fetch(`https://api.exchangerate.host/latest?base=GBP&region=${region}`);
const body = await res.json();
process.stdout.write(JSON.stringify(body.rates) + "\n");
