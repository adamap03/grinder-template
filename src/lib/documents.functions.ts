import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const Kind = z.enum(['CV', 'Cover letter']);

/** Uploaded old CVs or cover letters, newest first (undated last). */
export const listDocuments = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ kind: Kind }).parse(d))
  .handler(async ({ data, context }) => {
    const { listDocs } = await import('./documents.server');
    return (await listDocs(context.userId, data.kind)).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  });

export const uploadDocumentFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ kind: Kind, name: z.string().min(1).max(200), type: z.string().max(200), data: z.string().max(8_000_000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { uploadDocument } = await import('./notion-db.server');
    const { dateOf, tableOf } = await import('./documents.server');
    const r = await uploadDocument(context.userId, data.name, data.type, data.data, tableOf(data.kind), data.date ?? dateOf(data.name) ?? `${new Date().toISOString().slice(0, 7)}-01`);
    return r.error ? { ok: false as const, error: r.error.message } : { ok: true as const };
  });

/** A fresh link to open an uploaded file (links stored in Notion expire after an hour). */
export const openDocument = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ kind: Kind, id: z.string().max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    const { freshFileUrl } = await import('./notion-db.server');
    const { tableOf } = await import('./documents.server');
    return { url: await freshFileUrl(tableOf(data.kind), context.userId, data.id) };
  });

export const editDocument = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ kind: Kind, id: z.string().max(60), name: z.string().trim().min(1).max(200).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { editDoc } = await import('./documents.server');
    await editDoc(context.userId, data.kind, data.id, { ...(data.name ? { name: data.name } : {}), ...(data.date !== undefined ? { date: data.date } : {}) });
    return { ok: true as const };
  });

export const removeDocument = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ kind: Kind, id: z.string().max(60) }).parse(d))
  .handler(async ({ data, context }) => {
    const { removeDoc } = await import('./documents.server');
    await removeDoc(context.userId, data.kind, data.id);
    return { ok: true as const };
  });
