"use client";
// The orders list: a router push, a computed push (not a hop), a link to a
// page nobody serves, and a link back to itself (not a journey).
import Link from "next/link";
import { useRouter } from "next/navigation";

/** Every order. */
export default function OrdersPage({ next }: { next: string }) {
  const router = useRouter();
  return (
    <section>
      <button onClick={() => router.push("/orders/new")}>New order</button>
      <button onClick={() => router.push(next)}>Continue</button>
      <Link href="/archive">Archive</Link>
      <Link href="/orders">Refresh</Link>
    </section>
  );
}
