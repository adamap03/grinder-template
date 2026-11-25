import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Link for showing a PDF inside the page: no page-thumbnail sidebar, page fitted to the width so it is readable.
 *  Use this for every embedded PDF (see CORRECTIONS.md). */
export const pdfEmbedUrl = (url: string) => `${url.split('#')[0]}#navpanes=0&pagemode=none&view=FitH&zoom=page-width`;
