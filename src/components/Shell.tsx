import { Button } from "@/components/Button";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Eye, EyeOff, KeyRound, Loader2, Check, MessageCircle, X, Github, Linkedin, Youtube } from "lucide-react";
import { saveKeys, useKeys } from "@/lib/keys";
import { useServerFn } from "@tanstack/react-start";
import { validateTavily, listNebiusModels } from "@/lib/research.functions";
import { ProfileMenu } from "@/components/ProfileMenu";
import { ChatPanel } from './ChatPanel';
import { siteLinks } from '@/lib/site.functions';

// Footer icons; their URLs come from the Notion "Site links" table (blank = icon without a link).
const SOCIALS: { label: string; Icon: ComponentType<{ className?: string }>; hover: string }[] = [
  { label: "GitHub", Icon: Github, hover: "hover:text-foreground" },
  { label: "YouTube", Icon: Youtube, hover: "hover:text-red-600 dark:hover:text-red-400" },
  { label: "LinkedIn", Icon: Linkedin, hover: "hover:text-blue-600 dark:hover:text-blue-400" },
];

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const getLinks = useServerFn(siteLinks);
  useEffect(() => { getLinks().then(setLinks).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const keys = useKeys();
  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("grinder-open-keys", h);
    return () => window.removeEventListener("grinder-open-keys", h);
  }, []);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div className="relative isolate min-h-screen">
      <div
        className="fixed inset-0 -z-10 bg-cover bg-center"
        style={{ backgroundImage: "url(/tavily-landscape.jpg)" }}
        aria-hidden
      />
      <div className="fixed inset-0 -z-10 bg-background/35" aria-hidden />
      <header
        className={`sticky top-0 z-40 w-full border-b bg-background/75 backdrop-blur-xl transition ${
          scrolled ? "border-border/60 shadow-[0_1px_16px_-6px_oklch(0.25_0.01_60/0.18)]" : "border-border/30"
        }`}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary font-display text-lg text-primary-foreground ring-1 ring-foreground/10">
              g
            </span>
            <span className="text-lg font-semibold tracking-tight">Grinder</span>
            <span className="hidden font-display text-base italic text-muted-foreground/80 xl:inline">/careers</span>
          </Link>
          <nav aria-label="Primary" className="order-3 flex w-full flex-wrap items-center justify-center gap-1 text-sm lg:order-none lg:w-auto">
            {([
              ["/", "Discover"],
              ["/resume", "Resume"],
              ["/shortlist", "Shortlist"],
              ["/preparation", "Preparation"],
              ["/calendar", "Calendar"],
              ["/tracker", "Application Tracker"],
            ] as const).map(([to, l]) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: true }}
                className="rounded-full px-3 py-1.5 font-medium text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground"
                activeProps={{ className: "bg-primary !text-primary-foreground shadow-sm hover:!bg-primary hover:!text-primary-foreground" }}
              >
                {l}
              </Link>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <Button aria-label="Ask Grinder" title="Ask Grinder" className="grid h-9 w-9 place-items-center rounded-full border border-border/60 bg-glass-strong transition hover:bg-muted" onClick={()=>setAsk(true)}><MessageCircle className="h-4 w-4"/></Button>
            {/* AI and research run on the server's Claude key, so the "Connect keys" button is gone. */}
            <ProfileMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 pb-8">{children}</main>
      <footer className="relative mt-4 overflow-hidden border-t border-border/40">
        <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-8 px-5 py-10 text-xs text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col items-center gap-2 sm:items-start">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-primary font-display text-sm text-primary-foreground">g</span>
              <span className="text-sm font-semibold text-foreground">Grinder</span>
            </div>
            <p>/ Careers & Resume Workspace</p>
          </div>
          <div className="flex flex-col items-center gap-5 sm:items-end">
            <div className="flex flex-col items-center gap-2 sm:items-end">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Follow the build</p>
              <div className="dock flex items-center gap-2.5">
                {SOCIALS.map(({ label, Icon, hover }) => (
                  <a
                    key={label}
                    href={links[label] || undefined}
                    target={links[label] ? "_blank" : undefined}
                    rel="noreferrer"
                    aria-label={links[label] ? `${label} (opens in a new tab)` : `${label} (no link set)`}
                    className={`group relative grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-glass-strong text-muted-foreground shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-foreground/25 ${hover}`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                      {label}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </footer>
      {open && <Settings onClose={() => setOpen(false)} />}
      {ask&&<div className="fixed inset-0 z-50 grid place-items-center bg-foreground/20 p-4" onClick={()=>setAsk(false)}><div role="dialog" aria-label="Ask Grinder" aria-modal="true" className="w-full max-w-xl" onClick={e=>e.stopPropagation()}><Button aria-label="Close assistant" title="Close assistant" onClick={()=>setAsk(false)} className="mb-2 ml-auto grid h-8 w-8 place-items-center rounded-full bg-glass-strong"><X className="h-4 w-4"/></Button><ChatPanel title="Ask Grinder" context="Ask which company or role the user wants to explore if no employer context is provided. Do not invent candidate experience." className="h-[65dvh]" suggestions={['Help me choose a company to explore.','What role should I research next?']}/></div></div>}
    </div>
  );
}

function KeyField({
  label,
  hint,
  href,
  value,
  onChange,
  placeholder,
  status,
}: {
  label: string;
  hint: string;
  href: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  status: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="rounded-lg glass p-4">
      <div className="mb-2 flex items-center justify-between text-sm font-medium">
        {label}
        <span className="text-xs text-muted-foreground">{status}</span>
      </div>
      <div className="flex items-center rounded-lg bg-muted px-3">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-11 flex-1 bg-transparent text-sm outline-none"
        />
        <Button onClick={() => setShow(!show)} className="text-muted-foreground" aria-label="Toggle visibility">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {hint}{" "}
        <a href={href} target="_blank" rel="noreferrer" className="underline">
          {href.replace("https://", "")}
        </a>
      </p>
    </div>
  );
}

function Settings({ onClose }: { onClose: () => void }) {
  const keys = useKeys();
  const [tav, setTav] = useState(keys.tavily);
  const [neb, setNeb] = useState(keys.nebius);
  useEffect(() => {
    setTav((v) => v || keys.tavily);
    setNeb((v) => v || keys.nebius);
  }, [keys.tavily, keys.nebius]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; n: string }>({ t: "", n: "" });
  const vT = useServerFn(validateTavily);
  const vN = useServerFn(listNebiusModels);

  async function save() {
    setBusy(true);
    const [t, n] = await Promise.all([
      tav ? vT({ data: { apiKey: tav } }) : Promise.resolve({ ok: false as const, error: "Missing" }),
      neb ? vN({ data: { apiKey: neb } }) : Promise.resolve({ ok: false as const, error: "Missing", models: [] }),
    ]);
    setMsg({
      t: t.ok ? "Verified" : t.error,
      n: n.ok ? `Verified · ${n.models.length} models` : n.error,
    });
    saveKeys({
      tavily: t.ok ? tav : keys.tavily,
      nebius: n.ok ? neb : keys.nebius,
      model: n.ok && !n.models.includes(keys.model) ? n.models[0] || "" : keys.model,
    });
    setBusy(false);
    if (t.ok && n.ok) setTimeout(onClose, 600);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/20 p-4" onClick={onClose}>
      <div className="max-h-[90dvh] w-full max-w-lg space-y-3 overflow-y-auto rounded-lg glass-strong p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-3xl">Connect your keys</h2>
        <p className="text-sm text-muted-foreground">
          When signed in, keys are saved privately to your account so you only add them once. Update them here anytime.
        </p>
        <KeyField
          label="1 · Tavily API key"
          hint="Get your key at"
          href="https://app.tavily.com"
          value={tav}
          onChange={setTav}
          placeholder="tvly-xxxx..."
          status={msg.t || (keys.tavily ? "Saved" : "")}
        />
        <KeyField
          label="2 · Nebius AI Studio key"
          hint="Get your key at"
          href="https://tokenfactory.nebius.com"
          value={neb}
          onChange={setNeb}
          placeholder="eyJhbGci..."
          status={msg.n || (keys.nebius ? "Saved" : "")}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-muted-foreground">
            Close
          </Button>
          <Button
            onClick={save}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Verify & save
          </Button>
        </div>
      </div>
    </div>
  );
}
