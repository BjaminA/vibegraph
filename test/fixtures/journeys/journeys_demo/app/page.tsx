// The home page: two literal links, one templated, one leaving the app.
import Link from "next/link";
import { Nav } from "@/components/Nav";

/** The landing page. */
export default function HomePage({ featured }: { featured: string }) {
  return (
    <main>
      <Nav />
      <Link href="/orders">All orders</Link>
      <Link href={`/orders/${featured}`}>Featured order</Link>
      <Link href="https://example.invalid/help">Help</Link>
    </main>
  );
}
