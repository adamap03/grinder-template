import { createServerFn } from '@tanstack/react-start';

// Footer links (GitHub, YouTube, LinkedIn) come from the Notion "Site links" table so they can be set without code.
// Rows with no URL show the icon without a link.
const DEFAULT_LINKS = ['GitHub', 'YouTube', 'LinkedIn'];

export const siteLinks = createServerFn({ method: 'GET' }).handler(async () => {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  let r = await supabaseAdmin.from('site_links').select('label,url');
  const have = new Set(((r.data ?? []) as { label: string }[]).map((x) => x.label));
  const missing = DEFAULT_LINKS.filter((l) => !have.has(l));
  if (missing.length) {
    for (const label of missing) await supabaseAdmin.from('site_links').insert({ label, url: null });
    r = await supabaseAdmin.from('site_links').select('label,url');
  }
  const rows = (r.data ?? []) as { label: string; url: string | null }[];
  return Object.fromEntries(rows.map((x) => [x.label, /^https?:\/\//.test(x.url ?? '') ? x.url! : '']));
});
