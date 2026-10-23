// Download the source outlines: the one step in this folder that uses the network.
import axios from "axios";

export async function downloadOutlines(url: string): Promise<unknown> {
  const res = await axios.get(url, { timeout: 10000 });
  return res.data;
}
