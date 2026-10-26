import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity, ArrowRight, ArrowUpRight, BookOpen, Building2, CheckCircle2, ChevronRight,
  ClipboardCheck, CloudCog, Database, FileClock, FileText, Fingerprint, GitBranch,
  Globe2, HeartPulse, Layers3, LockKeyhole, Menu, Network, ShieldCheck, Stethoscope,
  UsersRound, WifiOff, Workflow, ChartNoAxesCombined, CircleDot, Mail, MapPin,
  Microscope, ScrollText, ServerCog, PanelTop, ExternalLink
} from 'lucide-react';

const nav = [
  { href: '/products/clinical-intelligence', label: 'Clinical Intelligence' },
  { href: '/products/hospital-os', label: 'Hospital OS' },
  { href: '/solutions', label: 'Solutions' },
  { href: '/technology', label: 'Technology & Trust' },
  { href: '/research', label: 'Research' },
  { href: '/company', label: 'Company' },
] as const;

export const siteEmail = (process.env.NEXT_PUBLIC_GHIMS_CONTACT_EMAIL || '').trim();
export const hasContact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(siteEmail);
export function emailLink(subject: string) {
  return hasContact ? 'mailto:' + siteEmail + '?subject=' + encodeURIComponent(subject) : '/contact';
}

function Mark() {
  return (
    <span aria-hidden="true" className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-cyan-400/30 bg-[#123c56] shadow-[inset_0_0_0_1px_rgba(255,255,255,.07)]">
      <span className="absolute -right-3 -top-3 h-8 w-8 rounded-full bg-cyan-400/20 blur-md" />
      <svg className="relative h-7 w-7" fill="none" viewBox="0 0 32 32">
        <path d="M25 8H13a8 8 0 0 0 0 16h12v-8h-9" stroke="#E5FCFE" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3"/>
        <path d="M19 3v7M19 22v7" stroke="#40D9D0" strokeLinecap="round" strokeWidth="2.5" />
      </svg>
    </span>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return <span className="inline-flex items-center gap-3">
    <Mark />
    <span className={'text-[22px] font-black tracking-[-.055em] ' + (light ? 'text-white' : 'text-[#123047]')}>G-HIMS<span className="text-cyan-500">.</span></span>
  </span>;
}

export function SiteHeader() {
  return <header className="sticky top-0 z-50 border-b border-white/10 bg-[#071c2d]/95 text-white backdrop-blur-xl">
    <div className="mx-auto flex h-[74px] max-w-[1340px] items-center justify-between gap-4 px-5 sm:px-8 xl:px-10">
      <Link href="/" aria-label="G-HIMS homepage" className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300"><Logo light /></Link>
      <nav aria-label="Main navigation" className="hidden items-center gap-5 text-[12px] font-semibold text-slate-200 lg:flex xl:gap-7">
        {nav.map(item => <Link key={item.href} href={item.href} className="transition hover:text-cyan-300 focus-visible:text-cyan-300">{item.label}</Link>)}
      </nav>
      <div className="hidden items-center gap-3 lg:flex">
        <Link href="/login" className="whitespace-nowrap px-2 text-xs font-semibold text-slate-300 transition hover:text-white">Staff login</Link>
        <Link href="/contact" className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-extrabold text-[#073048] transition hover:bg-cyan-300">Contact G-HIMS <ArrowUpRight size={15}/></Link>
      </div>
      <details className="group relative lg:hidden">
        <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-lg border border-white/20 focus-visible:outline-2 focus-visible:outline-cyan-300 [&::-webkit-details-marker]:hidden" aria-label="Open website menu"><Menu size={21}/></summary>
        <nav aria-label="Mobile navigation" className="absolute right-0 top-12 z-50 flex w-[min(90vw,310px)] flex-col gap-1 rounded-xl border border-white/15 bg-[#0d2a41] p-3 shadow-2xl">
          {nav.map(item => <Link key={item.href} href={item.href} className="rounded-lg px-3 py-3 text-sm font-semibold hover:bg-white/10">{item.label}</Link>)}
          <Link href="/resources" className="rounded-lg px-3 py-3 text-sm font-semibold hover:bg-white/10">Resources</Link>
          <Link href="/contact" className="rounded-lg bg-cyan-400 px-3 py-3 text-sm font-extrabold text-[#073048]">Contact G-HIMS</Link>
          <Link href="/login" className="rounded-lg px-3 py-3 text-sm font-semibold text-cyan-200 hover:bg-white/10">Staff login</Link>
        </nav>
      </details>
    </div>
  </header>;
}

export function SiteFooter() {
  return <footer className="bg-[#061827] text-slate-300">
    <div className="mx-auto grid max-w-[1340px] gap-10 px-5 py-16 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr] xl:px-10">
      <div><Link href="/" aria-label="G-HIMS homepage"><Logo light /></Link>
        <p className="mt-5 max-w-sm text-sm leading-7 text-slate-400">Clinical intelligence and hospital infrastructure designed for connected, accountable and resilient care.</p>
        <p className="mt-5 text-xs text-slate-500">Developed with clinician-governed workflows in mind. Pilot evaluation and institutional approvals remain essential.</p>
      </div>
      <div><h2 className="mb-4 text-xs font-extrabold uppercase tracking-[.15em] text-white">Products</h2>
        <div className="flex flex-col gap-3 text-sm"><Link href="/products/clinical-intelligence" className="hover:text-cyan-300">G-HIMS CI</Link><Link href="/products/hospital-os" className="hover:text-cyan-300">G-HIMS OS</Link><Link href="/solutions" className="hover:text-cyan-300">For hospitals</Link><Link href="/login" className="hover:text-cyan-300">Hospital sign in</Link></div>
      </div>
      <div><h2 className="mb-4 text-xs font-extrabold uppercase tracking-[.15em] text-white">Explore</h2>
        <div className="flex flex-col gap-3 text-sm"><Link href="/technology" className="hover:text-cyan-300">Technology & trust</Link><Link href="/research" className="hover:text-cyan-300">Clinical research</Link><Link href="/company" className="hover:text-cyan-300">Company</Link><Link href="/resources" className="hover:text-cyan-300">Resources</Link></div>
      </div>
      <div><h2 className="mb-4 text-xs font-extrabold uppercase tracking-[.15em] text-white">Connect</h2>
        <div className="flex flex-col gap-3 text-sm"><Link href="/contact" className="hover:text-cyan-300">Hospital enquiries</Link><Link href="/contact#partnerships" className="hover:text-cyan-300">Partnerships</Link><Link href="/privacy" className="hover:text-cyan-300">Privacy</Link><Link href="/terms" className="hover:text-cyan-300">Terms & clinical disclaimer</Link></div>
      </div>
    </div>
    <div className="border-t border-white/10"><div className="mx-auto flex max-w-[1340px] flex-col gap-2 px-5 py-5 text-xs text-slate-500 sm:flex-row sm:justify-between sm:px-8 xl:px-10"><span>© {new Date().getFullYear()} G-HIMS. All rights reserved.</span><span>Clinical decision-making remains with authorized healthcare professionals.</span></div></div>
  </footer>;
}

export function SiteFrame({ children }: { children: ReactNode }) {
  return <div data-ghims-website="true" className="min-h-screen bg-[#f6f9fa] font-sans text-[#163348] selection:bg-cyan-200">
    <a href="#main-content" className="sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:not-sr-only focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-slate-900">Skip to content</a>
    <SiteHeader /><main id="main-content">{children}</main><SiteFooter />
  </div>;
}
export function Eyebrow({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return <p className={'mb-5 flex items-center gap-3 text-[11px] font-extrabold uppercase tracking-[.21em] ' + (light ? 'text-cyan-300' : 'text-[#078b91]')}><span className="h-px w-7 bg-current" />{children}</p>;
}
export function Heading({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return <h2 className={'max-w-3xl text-[clamp(2rem,3.45vw,3.3rem)] font-bold leading-[1.12] tracking-[-.055em] ' + (light ? 'text-white' : 'text-[#102c41]')}>{children}</h2>;
}
export function ButtonLink({ href, children, outline = false, light = false }: { href: string; children: ReactNode; outline?: boolean; light?: boolean }) {
  return <Link href={href} className={'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-extrabold transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-400 ' +
    (outline ? (light ? 'border border-white/35 bg-white/5 text-white hover:bg-white/10' : 'border border-[#a1bdc6] bg-transparent text-[#10324a] hover:border-[#088b97]') : 'bg-cyan-400 text-[#09283d] hover:bg-cyan-300')}>
    {children} <ArrowUpRight size={17}/></Link>;
}
export function Intro({ eyebrow, title, body, accent }: { eyebrow: string; title: string; body: string; accent?: string }) {
  return <section className="relative overflow-hidden bg-[#08263b] text-white">
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_83%_15%,rgba(24,188,198,.18),transparent_47%)]"/>
    <div className="relative mx-auto max-w-[1340px] px-5 py-20 sm:px-8 lg:py-28 xl:px-10">
      <Eyebrow light>{eyebrow}</Eyebrow>
      <h1 className="max-w-5xl text-[clamp(2.7rem,5.2vw,5.3rem)] font-bold leading-[1.06] tracking-[-.065em]">{title} {accent && <span className="text-cyan-300">{accent}</span>}</h1>
      <p className="mt-7 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">{body}</p>
    </div>
  </section>;
}
export function Feature({ icon: Icon, title, children, index }: { icon: typeof Activity; title: string; children: ReactNode; index?: string }) {
  return <article className="flex h-full flex-col rounded-2xl border border-[#dce7ec] bg-white p-6 shadow-[0_12px_40px_rgba(11,47,68,.035)] sm:p-7">
    <div className="mb-9 flex items-start justify-between">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#e9f8f7] text-[#087e86]"><Icon size={22} strokeWidth={1.8}/></span>
      {index && <span className="text-sm font-extrabold tracking-widest text-[#99aeb7]">{index}</span>}
    </div>
    <h3 className="mb-3 text-xl font-bold leading-tight tracking-[-.035em] text-[#103249]">{title}</h3>
    <p className="text-sm leading-7 text-[#58707f]">{children}</p>
  </article>;
}
export function ClosingCTA({ title, body, href = '/contact', label = 'Discuss with G-HIMS' }: {title: string; body: string; href?: string; label?: string}) {
  return <section className="bg-[#0c344d] px-5 py-20 text-white sm:px-8">
    <div className="mx-auto flex max-w-[1250px] flex-col justify-between gap-7 lg:flex-row lg:items-end">
      <div><Eyebrow light>Start a conversation</Eyebrow><Heading light>{title}</Heading><p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300">{body}</p></div>
      <div className="shrink-0"><ButtonLink href={href}>{label}</ButtonLink></div>
    </div>
  </section>;
}
export function Measure({ value, name }: { value: string; name: string }) {
  return <div className="border-l-2 border-cyan-400/60 pl-5"><div className="text-lg font-extrabold tracking-tight text-[#14354a]">{value}</div><div className="mt-1 text-sm text-[#567486]">{name}</div></div>;
}
export function Section({children, soft = false}:{children: ReactNode;soft?: boolean}) {
  return <section className={'px-5 py-20 sm:px-8 lg:py-24 xl:px-10 ' + (soft ? 'bg-[#ecf3f5]' : 'bg-[#f7fafb]')}><div className="mx-auto max-w-[1250px]">{children}</div></section>;
}
export function ArrowText({ href, children }: {href:string;children:ReactNode}) {
  return <Link href={href} className="inline-flex items-center gap-2 text-sm font-extrabold text-[#047a85] underline-offset-4 hover:underline">{children}<ArrowRight size={16}/></Link>;
}
export function ProductVisualization() {
  return <div role="img" aria-label="Illustrative synthetic clinical review interface with trending results and an evidence trail" className="relative rounded-[22px] border border-white/15 bg-[#0b2438] p-3 shadow-[0_35px_85px_rgba(0,0,0,.3)] sm:p-5">
    <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/10 px-2 pb-4">
      <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-400/15 text-cyan-300"><HeartPulse size={17}/></span><span className="text-xs font-bold text-white">G-HIMS CI <span className="font-medium text-slate-400">/ Clinical review</span></span></div>
      <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">For review</span>
    </div>
    <div className="grid gap-3 sm:grid-cols-[1.35fr_.9fr]">
      <div className="space-y-3">
        <div className="rounded-xl border border-white/10 bg-[#142f46] p-4">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Patient 360 · Longitudinal context</div>
          <div className="text-sm font-bold text-white">What changed over time?</div>
          <div className="relative mt-5 h-32 overflow-hidden rounded-lg bg-[#0b2438]">
            <div className="absolute inset-0 flex flex-col justify-evenly px-3 opacity-35">{[1,2,3].map(n=><span key={n} className="border-t border-dashed border-cyan-400/30"/>)}</div>
            <svg viewBox="0 0 320 120" preserveAspectRatio="none" className="relative h-full w-full" aria-hidden="true">
              <defs><linearGradient id="site-trend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#42D7D1" stopOpacity=".3"/><stop offset="100%" stopColor="#42D7D1" stopOpacity="0"/></linearGradient></defs>
              <path d="M 8 104 L 68 92 L 121 89 L 178 65 L 232 70 L 310 26 L 310 120 L 8 120Z" fill="url(#site-trend)"/>
              <path d="M 8 104 L 68 92 L 121 89 L 178 65 L 232 70 L 310 26" fill="none" stroke="#42D7D1" strokeWidth="3"/>
              <circle cx="310" cy="26" r="5" fill="#a1fff0"/>
            </svg>
          </div>
          <div className="mt-3 flex justify-between text-[10px] text-slate-400"><span>Earlier</span><span>Recent</span></div>
        </div>
        <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-4"><div className="text-xs font-bold text-cyan-200">Trend for clinician review</div><p className="mt-2 text-xs leading-6 text-slate-300">An observed change is linked to source results. Confirm clinical relevance before taking action.</p></div>
      </div>
      <div className="rounded-xl border border-white/10 bg-[#142f46] p-4">
        <div className="flex items-center justify-between"><span className="text-xs font-bold text-white">Evidence trail</span><GitBranch size={16} className="text-cyan-300"/></div>
        <div className="mt-7 space-y-5">{[['Lab result','Source-linked'],['Encounter','In context'],['Clinical note','Reviewable']].map(([n,sub])=><div key={n} className="flex gap-3"><span className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-cyan-300"/><div><p className="text-xs font-semibold text-white">{n}</p><p className="mt-1 text-[10px] text-slate-400">{sub}</p></div></div>)}</div>
        <div className="mt-9 border-t border-white/10 pt-4 text-[11px] leading-5 text-slate-400"><ShieldCheck size={16} className="mb-2 text-cyan-300"/>Clinician confirmation remains required.</div>
      </div>
    </div>
    <p className="mt-4 text-center text-[10px] leading-5 text-slate-400">Illustrative interface, synthetic concepts only. Not a patient record or a validated clinical alert.</p>
  </div>;
}
export {
  Activity, ArrowRight, ArrowUpRight, BookOpen, Building2, CheckCircle2, ChevronRight,
  ClipboardCheck, CloudCog, Database, FileClock, FileText, Fingerprint, GitBranch,
  Globe2, HeartPulse, Layers3, LockKeyhole, Network, ShieldCheck, Stethoscope,
  UsersRound, WifiOff, Workflow, ChartNoAxesCombined, CircleDot, Mail, MapPin,
  Microscope, ScrollText, ServerCog, PanelTop, ExternalLink,
};
