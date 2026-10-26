import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  Check,
  ChevronRight,
  CircleCheck,
  Clock3,
  Database,
  FileText,
  GitBranch,
  HeartPulse,
  Layers3,
  LockKeyhole,
  Menu,
  Network,
  ShieldCheck,
  Stethoscope,
  WifiOff,
} from 'lucide-react';

const capabilities = [
  {
    icon: BookOpenText,
    number: '01',
    title: 'A longitudinal patient picture',
    body: 'Bring encounters, investigations, medication history and care transitions into a coherent view—without losing where each fact came from.',
    detail: 'Patient 360 · Source-linked context',
  },
  {
    icon: Activity,
    number: '02',
    title: 'Signals, not black-box conclusions',
    body: 'Help clinicians notice meaningful changes across time. Make the supporting evidence visible before a warning becomes a clinical decision.',
    detail: 'Trends · Deterioration review',
  },
  {
    icon: ShieldCheck,
    number: '03',
    title: 'Clinicians remain in control',
    body: 'Provide reviewable summaries and drafts. Clinical sign-off, escalation and changes to the medical record stay within authorized workflows.',
    detail: 'Review · Authority · Audit trail',
  },
] as const;

const process = [
  {
    number: '01',
    title: 'Connect clinical sources',
    body: 'Work with existing hospital systems or the native G-HIMS operating system.',
  },
  {
    number: '02',
    title: 'Assemble the clinical timeline',
    body: 'Reconcile events, results and encounters into a patient-scoped, traceable view.',
  },
  {
    number: '03',
    title: 'Surface evidence-linked insights',
    body: 'Present change over time, context and draft intelligence with source references.',
  },
  {
    number: '04',
    title: 'Put review in the clinical workflow',
    body: 'The authorized clinician evaluates, confirms or rejects the output.',
  },
] as const;

const contactEmail = process.env.NEXT_PUBLIC_GHIMS_CONTACT_EMAIL?.trim();
const validContactEmail =
  contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
    ? contactEmail
    : null;
const pilotEmailHref = validContactEmail
  ? 'mailto:' +
    validContactEmail +
    '?subject=' +
    encodeURIComponent('G-HIMS Clinical Intelligence — hospital pilot enquiry')
  : null;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3">
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-500 text-white shadow-[0_0_25px_rgba(59,130,246,0.35)]">
        <HeartPulse className="size-5" strokeWidth={2.2} />
      </span>
      <span className="flex flex-col leading-tight text-left">
        <span className="text-[15px] font-bold tracking-[-0.04em] text-white">G-HIMS <span className="font-medium text-blue-300">AI</span></span>
        {!compact && <span className="text-[9px] font-semibold uppercase tracking-[0.19em] text-slate-400">Clinical Intelligence</span>}
      </span>
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.2em] text-sky-300">
      <span aria-hidden="true" className="h-px w-7 bg-sky-400" />
      {children}
    </div>
  );
}

function ProductPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-[625px]">
      <div aria-hidden="true" className="absolute -inset-5 rounded-[36px] bg-blue-500/10 blur-3xl" />
      <div className="relative overflow-hidden rounded-[22px] border border-slate-600/55 bg-[#0c1b30] shadow-[0_35px_100px_rgba(0,0,0,0.46)]">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#10243a] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-blue-500/20 text-blue-300"><HeartPulse className="size-4" /></span>
            <span className="text-xs font-semibold tracking-tight text-white">G-HIMS <span className="text-sky-300">Clinical Intelligence</span></span>
          </div>
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">Review workspace</span>
        </div>
        <div className="border-b border-white/10 px-4 py-4 sm:px-6">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-medium text-slate-400">
            <span>Patient 360</span><ChevronRight className="size-3" /><span>Longitudinal intelligence</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-white">A clearer view of what changed</div>
              <p className="mt-1 text-[11px] text-slate-400">An evidence-linked clinical brief for clinician review</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-200"><LockKeyhole className="size-3" /> Clinician-controlled</span>
          </div>
        </div>
        <div className="grid gap-3 p-3 sm:grid-cols-[1.35fr_0.9fr] sm:p-4">
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-600/50 bg-[#132740] p-4">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-white"><Activity className="size-4 text-sky-300" /> Change over time</div>
                <span className="text-[10px] text-slate-400">Illustrative trend</span>
              </div>
              <div className="relative h-28 overflow-hidden rounded-lg border border-slate-600/40 bg-[#0a1b2d] px-2 pt-2">
                <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-evenly px-2">
                  <span className="border-t border-dashed border-slate-600/30" /><span className="border-t border-dashed border-slate-600/30" /><span className="border-t border-dashed border-slate-600/30" />
                </div>
                <svg viewBox="0 0 320 95" preserveAspectRatio="none" className="relative h-full w-full" aria-label="An illustrative upward laboratory trend" role="img">
                  <defs>
                    <linearGradient id="ghims-trend-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M 8 78 L 68 71 L 128 60 L 190 62 L 250 40 L 312 16 L 312 95 L 8 95 Z" fill="url(#ghims-trend-fill)" />
                  <path d="M 8 78 L 68 71 L 128 60 L 190 62 L 250 40 L 312 16" fill="none" stroke="#38bdf8" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="312" cy="16" r="5" fill="#7dd3fc" stroke="#0a1b2d" strokeWidth="3" />
                </svg>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-slate-400"><span>Earlier results</span><span>Recent results</span></div>
            </div>
            <div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.07] p-3.5">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-sky-200"><Activity className="size-3.5" /> Change for review</div>
              <p className="text-[11px] leading-relaxed text-slate-300">A changing laboratory trend is visible across the patient timeline. Review original results and clinical context before taking action.</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-600/50 bg-[#132740] p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white">Evidence trail</span>
                <GitBranch className="size-4 text-sky-300" />
              </div>
              <div className="mt-4 space-y-0">
                {[
                  ['Laboratory result', 'Source record attached'],
                  ['Previous encounter', 'Timeline context'],
                  ['Clinical note', 'Reviewable reference'],
                ].map(([title, subtitle], index) => (
                  <div key={title} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="grid size-6 shrink-0 place-items-center rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-300"><FileText className="size-3" /></div>
                      {index !== 2 && <div className="h-7 w-px bg-slate-600/60" />}
                    </div>
                    <div className="pb-3"><p className="text-[10px] font-medium text-slate-200">{title}</p><p className="mt-0.5 text-[9px] text-slate-400">{subtitle}</p></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] p-3">
              <div className="flex items-center gap-2 text-[10px] font-semibold text-emerald-300"><CircleCheck className="size-3.5" /> Clinical authority retained</div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-slate-300">AI output is not a signed clinical decision.</p>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-[10px] leading-relaxed text-slate-500">Illustrative interface using synthetic concepts. Not a patient record or a validated clinical alert.</figcaption>
    </figure>
  );
}

export function ClinicalIntelligenceLanding() {
  return (
    <div data-ghims-marketing="true" className="min-h-screen overflow-x-hidden bg-[#061321] font-sans text-slate-100 selection:bg-sky-500/30">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-white focus:p-3 focus:text-slate-900">Skip to main content</a>
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#071726]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[74px] max-w-7xl items-center justify-between gap-6 px-5 sm:px-8 lg:px-10">
          <Link href="/" aria-label="G-HIMS AI home" className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-400"><Brand /></Link>
          <nav aria-label="Primary navigation" className="hidden items-center gap-7 text-[13px] font-medium text-slate-300 lg:flex">
            <a className="transition hover:text-white" href="#why-ghims">Why G-HIMS</a>
            <a className="transition hover:text-white" href="#experience">Clinical Intelligence</a>
            <a className="transition hover:text-white" href="#architecture">The platform</a>
            <a className="transition hover:text-white" href="#pilot">Pilot programme</a>
          </nav>
          <div className="hidden items-center gap-4 sm:flex">
            <Link href="/login" className="text-[13px] font-semibold text-slate-300 transition hover:text-white">Staff sign in</Link>
            <a href="#pilot" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-500 px-4 text-[12px] font-semibold text-white transition hover:bg-blue-400">Explore a pilot <ArrowUpRight className="size-3.5" /></a>
          </div>
          <details className="group relative sm:hidden">
            <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-lg border border-white/15 text-white [&::-webkit-details-marker]:hidden" aria-label="Open navigation menu"><Menu className="size-5" /></summary>
            <nav aria-label="Mobile navigation" className="absolute right-0 top-12 flex w-64 flex-col gap-1 rounded-xl border border-white/15 bg-[#11253b] p-3 shadow-2xl">
              <a href="#why-ghims" className="rounded-lg px-3 py-2.5 text-sm hover:bg-white/10">Why G-HIMS</a>
              <a href="#experience" className="rounded-lg px-3 py-2.5 text-sm hover:bg-white/10">Clinical Intelligence</a>
              <a href="#architecture" className="rounded-lg px-3 py-2.5 text-sm hover:bg-white/10">The platform</a>
              <a href="#pilot" className="rounded-lg px-3 py-2.5 text-sm hover:bg-white/10">Pilot programme</a>
              <Link href="/login" className="rounded-lg px-3 py-2.5 text-sm font-semibold text-sky-300 hover:bg-white/10">Staff sign in</Link>
            </nav>
          </details>
        </div>
      </header>

      <main id="main-content">
        <section className="relative isolate overflow-hidden border-b border-white/10 bg-[radial-gradient(ellipse_at_76%_18%,rgba(25,90,173,0.25),transparent_47%),linear-gradient(180deg,#0a1c31_0%,#061321_100%)]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(125,211,252,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,0.1)_1px,transparent_1px)] [background-size:60px_60px] [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-16 sm:px-8 lg:grid-cols-[0.93fr_1.07fr] lg:gap-10 lg:px-10 lg:pb-28 lg:pt-24">
            <div className="max-w-xl">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-sky-400/25 bg-sky-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-sky-200">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-sky-400" /> Clinical intelligence, built for real hospitals
              </div>
              <h1 className="max-w-[650px] text-[clamp(2.5rem,4.8vw,4.6rem)] font-semibold leading-[1.08] tracking-[-0.055em] text-white">
                Patient data is fragmented. <span className="text-sky-300">Clinical understanding shouldn't be.</span>
              </h1>
              <p className="mt-7 max-w-[550px] text-base leading-[1.75] text-slate-300 sm:text-[17px]">
                G-HIMS Clinical Intelligence brings longitudinal records and evidence-linked insights into one reviewable clinical picture—while clinicians stay in charge of every decision.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <a href="#experience" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-500 px-5 text-[13px] font-bold text-white shadow-[0_10px_30px_rgba(37,99,235,0.24)] transition hover:bg-blue-400">Explore the experience <ArrowRight className="size-4" /></a>
                <a href="#architecture" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-500/60 bg-white/5 px-5 text-[13px] font-semibold text-white transition hover:border-sky-400/50 hover:bg-white/10">Built on G-HIMS OS <ArrowUpRight className="size-3.5" /></a>
              </div>
              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 border-t border-white/10 pt-6 text-[11px] font-medium text-slate-400">
                <span className="inline-flex items-center gap-2"><CircleCheck className="size-3.5 text-sky-300" /> Source-linked evidence</span>
                <span className="inline-flex items-center gap-2"><CircleCheck className="size-3.5 text-sky-300" /> Clinician-governed</span>
                <span className="inline-flex items-center gap-2"><CircleCheck className="size-3.5 text-sky-300" /> Designed for low infrastructure</span>
              </div>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section id="why-ghims" className="scroll-mt-24 border-b border-white/10 bg-[#091a2c] py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-24">
              <div>
                <SectionLabel>The problem</SectionLabel>
                <h2 className="max-w-lg text-[clamp(2rem,3.3vw,3.2rem)] font-semibold leading-[1.14] tracking-[-0.045em] text-white">More records don't automatically mean more clarity.</h2>
              </div>
              <div className="self-end">
                <p className="max-w-2xl text-base leading-8 text-slate-300">Clinical information is spread across visits, departments, lab systems and disconnected software. Rebuilding the full picture takes time—and important changes can be difficult to see in context.</p>
                <div className="mt-8 grid gap-3 sm:grid-cols-3">
                  {[
                    ['Fragmented history', 'The story of care is scattered.'],
                    ['Hidden changes', 'Patterns disappear between visits.'],
                    ['Limited traceability', 'Insights need visible sources.'],
                  ].map(([title, body]) => (
                    <div key={title} className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
                      <span aria-hidden="true" className="mb-4 block h-1 w-7 rounded-full bg-blue-400" />
                      <p className="text-sm font-semibold text-white">{title}</p>
                      <p className="mt-2 text-xs leading-5 text-slate-400">{body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="experience" className="scroll-mt-24 bg-[#061321] py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="max-w-3xl">
              <SectionLabel>The solution</SectionLabel>
              <h2 className="text-[clamp(2rem,3.5vw,3.25rem)] font-semibold leading-[1.14] tracking-[-0.045em] text-white">Intelligence that shows its work.</h2>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300">Not another EHR screen. A layer of context, change detection and clinical review built around the record you already have.</p>
            </div>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {capabilities.map(({ icon: Icon, number, title, body, detail }) => (
                <article key={number} className="group flex flex-col rounded-2xl border border-slate-700/70 bg-[#10243a] p-6 transition hover:-translate-y-1 hover:border-sky-400/45 sm:p-7">
                  <div className="mb-9 flex items-start justify-between">
                    <span className="grid size-12 place-items-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-300"><Icon className="size-5" /></span>
                    <span className="text-[12px] font-semibold tracking-widest text-slate-500">{number}</span>
                  </div>
                  <h3 className="max-w-xs text-xl font-semibold leading-snug tracking-[-0.03em] text-white">{title}</h3>
                  <p className="mt-4 flex-1 text-sm leading-7 text-slate-300">{body}</p>
                  <div className="mt-8 border-t border-white/10 pt-4 text-[11px] font-semibold text-sky-300">{detail}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-24 border-y border-white/10 bg-[#0b1d30] py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div><SectionLabel>How it works</SectionLabel><h2 className="max-w-2xl text-[clamp(2rem,3.2vw,3rem)] font-semibold leading-tight tracking-[-0.045em] text-white">From disconnected data to a reviewable insight.</h2></div>
              <p className="max-w-sm text-sm leading-7 text-slate-400">A governed workflow designed to support clinical reasoning, not replace professional judgment.</p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {process.map((step) => (
                <div key={step.number} className="relative border-l border-sky-400/40 pl-5">
                  <div className="text-xs font-bold tracking-widest text-sky-300">{step.number}</div>
                  <h3 className="mt-5 text-lg font-semibold leading-snug text-white">{step.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-400">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="architecture" className="scroll-mt-24 bg-[#061321] py-20 sm:py-28">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:gap-20 lg:px-10">
            <div>
              <SectionLabel>The foundation</SectionLabel>
              <h2 className="text-[clamp(2rem,3.3vw,3.2rem)] font-semibold leading-tight tracking-[-0.045em] text-white">One intelligence layer. <span className="text-sky-300">Two ways to adopt it.</span></h2>
              <p className="mt-6 max-w-lg text-base leading-8 text-slate-300">Hospitals should not have to replace their software to evaluate better clinical intelligence. G-HIMS CI is designed to integrate with existing systems, while G-HIMS OS provides a native event-driven foundation where needed.</p>
              <div className="mt-8 flex flex-wrap gap-3 text-xs font-semibold text-slate-300">
                <span className="rounded-full border border-white/15 px-3 py-2">Immutable clinical events</span>
                <span className="rounded-full border border-white/15 px-3 py-2">Auditability</span>
                <span className="rounded-full border border-white/15 px-3 py-2">Offline-first design</span>
                <span className="rounded-full border border-white/15 px-3 py-2">Tenant isolation</span>
              </div>
            </div>
            <div className="rounded-[26px] border border-white/10 bg-[#0d2137] p-5 shadow-[0_25px_70px_rgba(0,0,0,0.24)] sm:p-8">
              <div className="mb-5 flex items-center justify-between gap-2"><span className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-300">Deployment model</span><Network className="size-4 text-slate-400" /></div>
              <div className="rounded-xl border border-sky-400/30 bg-blue-500/10 p-5 text-center">
                <div className="mx-auto mb-2 grid size-10 place-items-center rounded-lg bg-blue-500/20 text-sky-300"><Activity className="size-5" /></div>
                <div className="font-semibold text-white">G-HIMS Clinical Intelligence</div>
                <div className="mt-1 text-[11px] text-slate-300">Evidence-linked insights · Human review</div>
              </div>
              <div className="mx-auto h-8 w-px bg-sky-400/45" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-[#142b45] p-4">
                  <div className="mb-3 grid size-9 place-items-center rounded-lg bg-sky-400/10 text-sky-300"><Database className="size-4" /></div>
                  <div className="text-sm font-semibold text-white">Existing hospital systems</div>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">Connect through governed data integrations.</p>
                  <div className="mt-4 text-[10px] font-bold text-sky-300">INTEGRATION PATH</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#142b45] p-4">
                  <div className="mb-3 grid size-9 place-items-center rounded-lg bg-sky-400/10 text-sky-300"><Layers3 className="size-4" /></div>
                  <div className="text-sm font-semibold text-white">G-HIMS OS</div>
                  <p className="mt-1 text-[11px] leading-5 text-slate-400">Native event-driven hospital infrastructure.</p>
                  <div className="mt-4 text-[10px] font-bold text-sky-300">NATIVE PATH</div>
                </div>
              </div>
              <p className="mt-5 text-center text-[11px] leading-5 text-slate-400">Integration scope and deployment controls are evaluated for each hospital.</p>
            </div>
          </div>
        </section>

        <section className="border-y border-white/10 bg-[#0b1d30] py-16 sm:py-20" aria-labelledby="design-heading">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <h2 id="design-heading" className="mb-9 text-xl font-semibold tracking-tight text-white">Designed around hospital realities.</h2>
            <div className="grid gap-5 md:grid-cols-3">
              {[
                { icon: WifiOff, title: 'Intermittent connectivity', body: 'Offline continuity and recovery are part of the system design, not an afterthought.' },
                { icon: LockKeyhole, title: 'Bounded clinical authority', body: 'Role-scoped actions and server-side authorization are fundamental to the workflow.' },
                { icon: Clock3, title: 'A record of what happened', body: 'Event provenance and traceable changes support review and accountability.' },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-sky-300"><Icon className="size-5" /></span>
                  <div><h3 className="text-sm font-semibold text-white">{title}</h3><p className="mt-2 text-xs leading-6 text-slate-400">{body}</p></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pilot" className="scroll-mt-24 relative overflow-hidden bg-[radial-gradient(ellipse_at_85%_45%,rgba(42,108,211,0.2),transparent_45%),#071625] py-20 sm:py-28">
          <div className="mx-auto grid max-w-7xl items-center gap-8 px-5 sm:px-8 lg:grid-cols-[1.2fr_0.8fr] lg:gap-16 lg:px-10">
            <div>
              <SectionLabel>Hospital pilots</SectionLabel>
              <h2 className="max-w-2xl text-[clamp(2rem,3.7vw,3.55rem)] font-semibold leading-[1.15] tracking-[-0.05em] text-white">Evaluate what matters, in your clinical environment.</h2>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-300">We are preparing governed clinical evaluations with hospital teams: reviewed cases, evidence traceability, clinician feedback and carefully defined success criteria.</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {pilotEmailHref ? (
                  <a href={pilotEmailHref} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-500 px-5 text-sm font-bold text-white transition hover:bg-blue-400">Discuss a hospital pilot <ArrowUpRight className="size-4" /></a>
                ) : (
                  <a href="#workflow" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-500 px-5 text-sm font-bold text-white transition hover:bg-blue-400">Explore the evaluation workflow <ArrowRight className="size-4" /></a>
                )}
                <Link href="/login" className="inline-flex min-h-12 items-center gap-2 px-4 text-sm font-semibold text-slate-300 transition hover:text-white">Hospital staff access <ArrowRight className="size-4" /></Link>
              </div>
              {!pilotEmailHref && <p className="mt-4 max-w-lg text-xs leading-6 text-slate-400">Pilot enquiry contact details will appear here once an official G-HIMS contact address is configured.</p>}
            </div>
            <div className="rounded-2xl border border-sky-400/20 bg-[#112740]/75 p-6 sm:p-8">
              <div className="mb-6 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-sky-300"><Stethoscope className="size-4" /> Evaluation principles</div>
              <div className="space-y-5">
                {[
                  'Qualified clinicians review the findings.',
                  'Source records remain available for verification.',
                  'Errors, false alerts and missed changes are measured.',
                  'Clinical deployment requires appropriate approvals.',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3 text-sm leading-6 text-slate-200"><Check className="mt-1 size-4 shrink-0 text-sky-300" /> {item}</div>
                ))}
              </div>
              <div className="mt-7 border-t border-white/10 pt-4 text-[11px] leading-6 text-slate-400">Pilot and evaluation activities are not claims of clinical validation, regulatory clearance or general availability.</div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#05111e]">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center lg:px-10">
          <div><Brand compact /><p className="mt-3 max-w-md text-xs leading-6 text-slate-400">A clinical intelligence layer built on governed, event-driven healthcare infrastructure.</p></div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs font-medium text-slate-400">
            <a href="#experience" className="hover:text-white">Clinical Intelligence</a>
            <a href="#architecture" className="hover:text-white">G-HIMS OS</a>
            <a href="#pilot" className="hover:text-white">Pilots</a>
            <Link href="/login" className="hover:text-white">Staff sign in</Link>
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-2 border-t border-white/10 px-5 py-5 text-[11px] text-slate-500 sm:flex-row sm:px-8 lg:px-10">
          <span>© {new Date().getFullYear()} G-HIMS. All rights reserved.</span>
          <span>Clinical intelligence supports, but does not replace, clinician judgment.</span>
        </div>
      </footer>
    </div>
  );
}
