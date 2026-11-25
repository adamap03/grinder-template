// Cover letters made in Preparation > Create new cover letter: the letter model, the letter types offered, and PDF /
// Word export. Saved in the Notion "Past cover letters" table (data = this model, text = the letter as plain text).
import { z } from 'zod';

/** Starting points offered in the creator. Add a type here and it appears in the picker and guides Claude's draft. */
export const LETTER_TYPES = [
  {
    id: 'graduate', name: 'Graduate scheme',
    blurb: 'Applying to a structured graduate programme.',
    guide: 'A UK graduate scheme application. Open with the scheme by name and why this firm. Show degree, relevant modules or dissertation, placements and projects as evidence of the competencies graduate recruiters screen for (technical ability, teamwork, communication, motivation for the sector, progress towards chartership). One page.',
  },
  {
    id: 'internship', name: 'Internship / placement',
    blurb: 'A summer internship, industrial placement or year in industry.',
    guide: 'A UK internship or industrial placement application. Open with the placement, its dates if known and the course the candidate is on. Emphasise eagerness to learn, transferable skills from study, projects, part-time work and societies, and what they hope to contribute and gain. One page.',
  },
] as const;
export type LetterType = (typeof LETTER_TYPES)[number]['id'];

export const LetterFormatSchema = z.object({
  font: z.enum(['Arial', 'Georgia', 'Helvetica', 'Times New Roman']),
  fontSize: z.number().min(9).max(13),
  margin: z.number().min(15).max(30),
  accent: z.enum(['charcoal', 'green', 'blue']),
});
export const LetterSchema = z.object({
  type: z.string(),
  company: z.string(),
  role: z.string(),
  sender: z.object({ name: z.string(), contact: z.string() }),
  date: z.string(),
  recipient: z.string(), // name, title and address, one per line
  salutation: z.string(),
  paragraphs: z.array(z.string()),
  signOff: z.string(),
  format: LetterFormatSchema,
  inspiredBy: z.array(z.string()), // names of the past letters Claude drew on
  check: z.array(z.string()), // things the draft could not know (to fill in or confirm)
});
export type Letter = z.infer<typeof LetterSchema>;
export type LetterFormat = z.infer<typeof LetterFormatSchema>;

export const defaultLetterFormat: LetterFormat = { font: 'Arial', fontSize: 11, margin: 22, accent: 'charcoal' };
export const ACCENT_RGB = { charcoal: [42, 42, 42], green: [38, 86, 60], blue: [41, 75, 106] } as const;

export const todayLong = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function blankLetter(type: LetterType, sender: Letter['sender']): Letter {
  return { type, company: '', role: '', sender, date: todayLong(), recipient: 'Hiring Manager', salutation: 'Dear Hiring Manager,', paragraphs: [''], signOff: 'Yours sincerely,', format: defaultLetterFormat, inspiredBy: [], check: [] };
}

/** Saved rows may predate a field; fill gaps so an old letter always opens. */
export function readLetter(v: unknown): Letter | null {
  const r = LetterSchema.partial().safeParse(v);
  if (!r.success || !Array.isArray(r.data.paragraphs)) return null;
  const base = blankLetter('graduate', { name: '', contact: '' });
  return { ...base, ...r.data, format: { ...defaultLetterFormat, ...(r.data.format ?? {}) } } as Letter;
}

/** The letter as plain text, top to bottom (saved for search and as inspiration for later letters). */
export function letterText(l: Letter): string {
  return [l.sender.name, l.sender.contact, '', l.date, '', l.recipient, '', l.role ? `Re: ${l.role}` : '', '', l.salutation, '', ...l.paragraphs.flatMap((p) => [p, '']), l.signOff, '', l.sender.name]
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const fileName = (l: Letter) => `Cover letter - ${[l.company, l.role].filter(Boolean).join(' - ') || 'draft'}`.replace(/[\\/:*?"<>|]/g, '');
const jsFont = (f: LetterFormat['font']) => (f === 'Georgia' || f === 'Times New Roman' ? 'times' : 'helvetica');

export async function letterPDF(l: Letter) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const { margin: m, fontSize, accent } = l.format;
  const width = 210 - m * 2, line = fontSize * 0.3528 * 1.45, font = jsFont(l.format.font);
  let y = m;
  const write = (text: string, opts: { bold?: boolean; color?: readonly number[]; size?: number; gapAfter?: number } = {}) => {
    pdf.setFont(font, opts.bold ? 'bold' : 'normal');
    pdf.setFontSize(opts.size ?? fontSize);
    const c = opts.color ?? [42, 42, 42];
    pdf.setTextColor(c[0]!, c[1]!, c[2]!);
    for (const t of text.split('\n').flatMap((p) => (p ? (pdf.splitTextToSize(p, width) as string[]) : ['']))) {
      if (y + line > 297 - m) { pdf.addPage(); y = m; }
      pdf.text(t, m, y + line * 0.75);
      y += line;
    }
    y += opts.gapAfter ?? line * 0.6;
  };
  write(l.sender.name, { bold: true, size: fontSize + 5, color: ACCENT_RGB[accent], gapAfter: 0 });
  write(l.sender.contact, { size: fontSize - 1 });
  write(l.date);
  write(l.recipient);
  if (l.role) write(`Re: ${l.role}`, { bold: true });
  write(l.salutation);
  for (const p of l.paragraphs.filter((p) => p.trim())) write(p);
  write(l.signOff, { gapAfter: line * 1.6 });
  write(l.sender.name, { bold: true });
  pdf.save(`${fileName(l)}.pdf`);
}

export async function letterDOCX(l: Letter) {
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
  const tw = (mm: number) => Math.round(mm * 56.7);
  const font = l.format.font, size = l.format.fontSize * 2;
  const color = ({ charcoal: '2A2A2A', green: '26563C', blue: '294B6A' } as const)[l.format.accent];
  const para = (text: string, o: { bold?: boolean; size?: number; color?: string; after?: number } = {}) =>
    new Paragraph({ spacing: { after: tw(o.after ?? 3), line: 276 }, children: text.split('\n').map((t, i) => new TextRun({ text: t, break: i ? 1 : 0, font, size: o.size ?? size, bold: o.bold ?? false, color: o.color ?? '2A2A2A' })) });
  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: tw(l.format.margin), bottom: tw(l.format.margin), left: tw(l.format.margin), right: tw(l.format.margin) } } },
      children: [
        para(l.sender.name, { bold: true, size: size + 10, color, after: 0 }),
        para(l.sender.contact, { size: size - 2 }),
        para(l.date),
        para(l.recipient),
        ...(l.role ? [para(`Re: ${l.role}`, { bold: true })] : []),
        para(l.salutation),
        ...l.paragraphs.filter((p) => p.trim()).map((p) => para(p)),
        para(l.signOff, { after: 10 }),
        para(l.sender.name, { bold: true }),
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${fileName(l)}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
