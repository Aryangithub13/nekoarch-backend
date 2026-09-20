/** One awaited shutdown shared by signals and startup failure cleanup. */
export function createShutdown(close: () => Promise<void>, flush: () => Promise<unknown>, failed: () => void) {
  let pending: Promise<void> | undefined;
  return () => pending ??= (async () => {
    try { await close(); } catch { failed(); }
    try { if (await flush() === false) failed(); } catch { failed(); }
  })();
}
