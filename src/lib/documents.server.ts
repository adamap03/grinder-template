// Old CVs and cover letters uploaded in the app, each kind in its own Notion table (files up to 5 MB live in Notion).

export type Doc = { id: string; name: string; date: string | null; url: string };
export type Kind = 'CV' | 'Cover letter';
export const tableOf = (kind: Kind) => (kind === 'CV' ? 'resume_history' : 'cover_letters') as 'resume_history' | 'cover_letters';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The month written in a file name, as YYYY-MM-01 (only month and year matter): "CV 2025-03", "cover letter
 *  12.03.2024", "cv march 2024", "CV November 26", "CV 1126" (Nov 2026), "CV 042026" (Apr 2026); else null. */
export function dateOf(name: string): string | null {
  const n = name.toLowerCase();
  const iso = n.match(/(20\d{2})[-_. ](\d{1,2})(?:[-_. ](\d{1,2}))?/);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, '0')}-01`;
  const dmy = n.match(/\b(\d{1,2})[-_./](\d{1,2})[-_./](20\d{2}|\d{2})\b/);
  if (dmy) { const y = dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3]; return `${y}-${dmy[2]!.padStart(2, '0')}-01`; }
  const my = n.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-_ ]*(20\d{2}|\d{2})\b/);
  if (my) return `${my[2]!.length === 2 ? `20${my[2]}` : my[2]}-${String(MONTHS.indexOf(my[1]!) + 1).padStart(2, '0')}-01`;
  // Number codes: MMYYYY ("042026") or MMYY ("1126" = November 2026).
  const mmyyyy = n.match(/(?<!\d)(0[1-9]|1[0-2])(20\d{2})(?!\d)/);
  if (mmyyyy) return `${mmyyyy[2]}-${mmyyyy[1]}-01`;
  const mmyy = n.match(/(?<!\d)(0[1-9]|1[0-2])(\d{2})(?!\d)/);
  if (mmyy) return `20${mmyy[2]}-${mmyy[1]}-01`;
  return null;
}

export async function listDocs(uid: string, kind: Kind): Promise<Doc[]> {
  const { userClient } = await import('@/integrations/supabase/client.server');
  const r = await userClient(uid).from(tableOf(kind)).select('*');
  return (r.data ?? []).map((d) => ({ id: String(d['id']), name: String(d['name']), date: (d['date'] as string | null) ?? (String(d['created_at'] ?? '').slice(0, 10) || null), url: String(d['file'] ?? '') }));
}

export async function editDoc(uid: string, kind: Kind, id: string, patch: { name?: string; date?: string | null }) {
  const { userClient } = await import('@/integrations/supabase/client.server');
  await userClient(uid).from(tableOf(kind)).update(patch).eq('id', id);
}

export async function removeDoc(uid: string, kind: Kind, id: string) {
  const { userClient } = await import('@/integrations/supabase/client.server');
  await userClient(uid).from(tableOf(kind)).delete().eq('id', id);
}
