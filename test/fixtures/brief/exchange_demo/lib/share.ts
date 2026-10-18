// The ledger platform's sharing API: a shared zone's documents are copied, by
// the platform, to every node it is shared with — in both directions.
export async function shareZone(zone: string, node: string): Promise<void> {
  await fetch(`https://ledger.example/share/${zone}`, { method: "POST", body: JSON.stringify({ node }) });
}
