// One order: an anonymous visitor is redirected to sign in.
import { redirect } from "next/navigation";

/** One order, for a signed-in user. */
export default function OrderPage({ user }: { user: string | null }) {
  if (!user) redirect("/login");
  return <article>order</article>;
}
