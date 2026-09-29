// A component the home page renders: its link is on the home page's thread.
import Link from "next/link";

export function Nav() {
  return (
    <nav>
      <Link href="/login">Sign in</Link>
    </nav>
  );
}
