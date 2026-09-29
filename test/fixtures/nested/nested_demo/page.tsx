// Nested helpers, the shape React code is full of: a function declared inside
// an effect and called there, a const arrow helper, and an inner function that
// shares its name with a top-level one.
import { useEffect } from "react";
import { fetchThing } from "./api";

export function Panel() {
  useEffect(() => {
    async function load() {
      const r = await fetchThing(1);
      console.log(r);
    }
    load();
  }, []);
  return null;
}

export function helper() {
  const inner = () => fetchThing(2);
  function shadow() {
    return 3;
  }
  inner();
  shadow();
}

function shadow() {
  return fetchThing(9);
}

export function twice(flag: boolean) {
  if (flag) {
    function pick() { return 1; }
    pick();
  } else {
    function pick() { return 2; }
    pick();
  }
}
