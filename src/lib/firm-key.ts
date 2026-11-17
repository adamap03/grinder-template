// The one way firms are matched by name, used by Discover (merging a firm's office listings), every source read and
// the import script, so "duplicate or not" is decided the same everywhere. Ignores case, punctuation, "&"/"and",
// Ltd/Limited/LLP/PLC/UK and single letters (directory index letters like "G GC Robertson", middle initials like
// "Anthony P Davies").
export function firmKey(name: string): string {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/\b(ltd|limited|llp|plc|uk)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter((w) => w.length > 1).join(' ');
}

/** The website's host without www, for matching firms by site. */
export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Whether two names are the same firm, allowing a shortened name ("Narro" and "Narro Associates", "Price and Myers"
 *  and "Price & Myers LLP"). Used to link Application tracker rows to Shortlist firms. */
export function sameFirm(a: string, b: string): boolean {
  const [x, y] = [firmKey(a), firmKey(b)].sort((p, q) => p.length - q.length) as [string, string];
  return !!x && (x === y || (x.length >= 4 && y.startsWith(`${x} `)));
}
