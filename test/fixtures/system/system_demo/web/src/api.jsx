// Frontend API client for system_demo. The system-tier aggregator
// text-scans this file for route-path literals (no JS parsing) and draws
// low-confidence frontend -> endpoint `calls` edges.

export function listUsers() {
  return fetch("/api/users").then((r) => r.json());
}

export function getUser(id) {
  return fetch(`/api/users/${id}`).then((r) => r.json());
}

export function createCharge(amount) {
  return fetch("/api/charges", {
    method: "POST",
    body: JSON.stringify({ amount }),
  }).then((r) => r.json());
}
