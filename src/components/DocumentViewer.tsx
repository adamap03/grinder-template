import { Loader2 } from 'lucide-react';
import { pdfEmbedUrl } from '@/lib/utils';

export type Viewed = { id: string; name: string; url: string | null; text: string; pdf: boolean };

/** An uploaded CV or cover letter shown in place (Resume page and Cover letters, left panel): PDFs in the browser's
 *  viewer without the page sidebar (pdfEmbedUrl), other files as their text. url null = still loading. */
export function DocumentViewer({ doc }: { doc: Viewed }) {
  if (!doc.url) return <div className="grid h-full place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (doc.pdf) return <iframe title={doc.name} src={pdfEmbedUrl(doc.url)} className="h-full w-full border-0 bg-white" />;
  if (doc.text) return <div className="h-full overflow-auto bg-muted/40 p-5"><div className="mx-auto max-w-[650px] whitespace-pre-wrap bg-white p-10 text-sm text-[#2a2a2a] shadow">{doc.text}</div></div>;
  return <p className="p-5 text-sm">This file's text could not be read here. <a href={doc.url} target="_blank" rel="noreferrer" className="underline">Download it</a> to read it.</p>;
}
