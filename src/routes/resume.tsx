import { createFileRoute } from '@tanstack/react-router';
import { Shell } from '@/components/Shell';
import { ResumeWorkspace } from '@/components/ResumeWorkspace';
import { DocumentHistory } from '@/components/DocumentHistory';
import { z } from 'zod';
import { pageHead } from '@/lib/seo';
export const Route = createFileRoute('/resume')({
  validateSearch: z.object({ job: z.string().max(2000).optional(), target: z.string().max(200).optional() }),
  head: () =>
    pageHead({
      title: 'Resume Workspace — Grinder',
      description: 'Upload, edit and refine your resume with a live document preview, researched suggestions and PDF or Word downloads.',
      path: '/resume',
    }),
  component: ResumePage,
});
function ResumePage(){const {job,target}=Route.useSearch();return <Shell><ResumeWorkspace jobURL={job || ''} target={target || ''} aside={(pick)=><DocumentHistory kind="CV" title="Resume history" intro={pick.onSelect?'Past CVs you upload here (up to 5 MB each), newest first. Click a dot to show that CV on the left.':'Past CVs you upload here (up to 5 MB each), newest first, so you can see how they have changed.'} className="mt-0" onSelect={pick.onSelect} onOpen={pick.onSelect} selectedId={pick.selectedId}/>}/></Shell>;}