// Old CVs and cover letters uploaded in the app, each kind in its own Notion table (files up to 5 MB live in Notion).

export type Doc = { id: string; name: string; date: string | null; url: string; created: boolean }; // created = made in the app (no file)
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
  return (r.data ?? []).map((d) => ({ id: String(d['id']), name: String(d['name']), date: (d['date'] as string | null) ?? (String(d['created_at'] ?? '').slice(0, 10) || null), url: String(d['file'] ?? ''), created: !d['file'] && !!(d['data'] as { paragraphs?: unknown } | null)?.paragraphs }));
}

export async function editDoc(uid: string, kind: Kind, id: string, patch: { name?: string; date?: string | null }) {
  const { userClient } = await import('@/integrations/supabase/client.server');
  await userClient(uid).from(tableOf(kind)).update(patch).eq('id', id);
}

export async function removeDoc(uid: string, kind: Kind, id: string) {
  const { userClient } = await import('@/integrations/supabase/client.server');
  await userClient(uid).from(tableOf(kind)).delete().eq('id', id);
}

/** Plain text of an uploaded PDF or Word file (empty when it cannot be read). */
async function fileText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (!res?.ok) return '';
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  try {
    if (head[0] === 0x25 && head[1] === 0x50) return (await (await import('./claude.server')).pdfText(buf)).trim(); // %PDF
    if (head[0] === 0x50 && head[1] === 0x4b) { // PK: .docx
      const mammoth = await import('mammoth');
      return (await mammoth.extractRawText({ buffer: Buffer.from(buf) })).value.trim();
    }
    return new TextDecoder().decode(buf).trim();
  } catch (e) { console.error('cover letter text:', (e as Error).message); return ''; }
}

/** The user's past cover letters with their text, newest first. Text of uploaded files is read once and saved on the
 *  row (at most `extract` files per call, so a first run stays quick). */
export async function pastLetters(uid: string, limit = 12, extract = 6): Promise<{ id: string; name: string; date: string | null; text: string }[]> {
  const { userClient } = await import('@/integrations/supabase/client.server');
  const { freshFileUrl } = await import('./notion-db.server');
  const db = userClient(uid);
  const rows = ((await db.from('cover_letters').select('*')).data ?? [])
    .map((d) => ({ id: String(d['id']), name: String(d['name']), date: (d['date'] as string | null) ?? null, text: String(d['text'] ?? ''), file: !!d['file'] }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, limit);
  for (const r of rows.filter((r) => !r.text && r.file).slice(0, extract)) {
    const url = await freshFileUrl('cover_letters', uid, r.id);
    r.text = url ? (await fileText(url)).slice(0, 20000) : '';
    if (r.text) await db.from('cover_letters').update({ text: r.text }).eq('id', r.id);
  }
  return rows.map(({ file: _f, ...r }) => r);
}

/** One uploaded CV or cover letter: its name, a fresh file link, and its text (read from the file once, then saved on
 *  the row). Notion is always asked for the file, since a just-uploaded row is cached without its file link. */
export async function docSource(uid: string, kind: Kind, id: string, withText = true) {
  const { userClient } = await import('@/integrations/supabase/client.server');
  const { freshFileUrl } = await import('./notion-db.server');
  const db = userClient(uid);
  const { data: row } = await db.from(tableOf(kind)).select('*').eq('id', id).maybeSingle();
  if (!row) return null;
  const made = !!(row['data'] as { paragraphs?: unknown } | null)?.paragraphs; // a cover letter made in the app: no file
  const url = made ? null : await freshFileUrl(tableOf(kind), uid, id);
  let text = String(row['text'] ?? '');
  if (withText && !text && url) {
    text = (await fileText(url)).slice(0, 20000);
    if (text) await db.from(tableOf(kind)).update({ text }).eq('id', id);
  }
  return { name: String(row['name']), url, text, data: row['data'] as unknown, parsed: row['parsed'] as unknown };
}

/** Whether an uploaded file is shown as a PDF (by its name; renamed files without an extension are treated as PDF). */
export const isPdfName = (name: string) => !/\.(docx?|odt|txt)$/i.test(name);

/** One past cover letter with its text. */
export const letterSource = (uid: string, id: string) => docSource(uid, 'Cover letter', id);
