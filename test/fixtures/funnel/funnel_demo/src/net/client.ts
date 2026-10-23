// The project's one HTTP door for the dashboard.
import axios from "axios";
import { request } from "undici";

export type Requester = typeof request;

export async function getJson(url: string): Promise<unknown> {
  const res = await axios.get(url, { timeout: 10000 });
  return res.data;
}
