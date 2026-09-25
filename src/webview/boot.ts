// The boot screen's two behaviours on the webview side. The markup is the
// server's (src/shared/boot_markup.ts), painted beside #root before this
// bundle loads.

/** Tick the elapsed line: the honest progress signal, since a big project
 *  parses for a minute or more and the server sends no percentage. Silent
 *  for the first two seconds; a small project is done by then. */
export function startBootClock(): void {
  const t0 = performance.now();
  const id = window.setInterval(() => {
    const el = document.querySelector<HTMLElement>("[data-boot-elapsed]");
    if (!el) { window.clearInterval(id); return; }
    const s = Math.floor((performance.now() - t0) / 1000);
    el.textContent = s >= 2 ? `${s} s` : "";
  }, 1000);
}

/** Fade the boot screen out and remove it. Idempotent. */
export function dismissBootScreen(): void {
  const el = document.querySelector<HTMLElement>("[data-boot-screen]");
  if (!el || el.classList.contains("vg-boot-out")) return;
  el.classList.add("vg-boot-out");
  window.setTimeout(() => el.remove(), 320);
}
