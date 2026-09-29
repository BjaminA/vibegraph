export async function fetchThing(n: number): Promise<Response> {
  return fetch("https://example.invalid/" + n);
}
