// Merging the data of two devices. Each saved item (a watchlist, the holdings, the journal…) carries the time it was
// last changed; per item the newest wins. A device that joins for the first time takes the items already in the sync
// (so its default watchlist never overwrites your real one) and adds only what the sync does not have yet.
// Pure functions.

/**
 * local, remote: {key: {t, v}} (t = last change, ms). joining: true for a device's first sync.
 * Returns {apply: {key: {t, v}} (to save on this device), push: boolean (the sync needs this device's data), merged}.
 */
export function mergeBundles(local, remote, { joining = false } = {}) {
  const apply = {}, merged = { ...remote };
  let push = false;
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const L = local[k], R = remote[k];
    if (L && !R) { merged[k] = L; push = true; continue; }
    if (!L && R) { apply[k] = R; continue; }
    const same = JSON.stringify(L.v) === JSON.stringify(R.v);
    if (same) { merged[k] = { v: R.v, t: Math.max(L.t || 0, R.t || 0) }; continue; }
    if (joining || (R.t || 0) > (L.t || 0)) { apply[k] = R; merged[k] = R; }
    else { merged[k] = L; push = true; }
  }
  return { apply, push, merged };
}

/** Items that stay on each device: caches, scan results, screen state, secrets. */
const LOCAL = /^(settings|onboarded|theme|lastSym\..*|screen\..*|lastQuotes|earnNext|review\.entries|mktPhase|sync\..*|signalsSeen|fx\..*|newsSeen|fund\.seen|fund\.checked|isinSym|evo\..*|fund\.mode|fund\.range|routine)$/;
export const syncable = k => !LOCAL.test(k);
