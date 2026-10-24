import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { getPublicRuntimeMode } from '@/lib/runtime/environment-contract';

interface PageProps {
  params: Promise<{ tenantId: string }>;
}

/**
 * Demo landing inside the real G-HIMS AI codebase. No simulated AI response,
 * no bypass of Patient 360 session authorization, and no patient data loaded here.
 * A separate DEMO Firebase project must first hold the seeded synthetic chart.
 */
export default async function ClinicalIntelligenceDemoPage({ params }: PageProps) {
  const { tenantId } = await params;
  const allowedTenant = String(process.env.GHIMS_DEMO_TENANT_ID || '').trim().toLowerCase();
  const project = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientProject = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  const demoProject = String(process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO || '').trim();
  const demoClientProject = String(process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO || '').trim();
  if (
    getRuntimeMode() !== 'DEMO' ||
    getPublicRuntimeMode() !== 'DEMO' ||
    !allowedTenant ||
    tenantId !== allowedTenant ||
    !demoProject ||
    project !== demoProject ||
    clientProject !== demoProject ||
    demoClientProject !== demoProject ||
    project === 'g-hims-ai' ||
    project === 'studio-1130431360-48a05'
  ) notFound();

  const clinicalRecordPath = `/${encodeURIComponent(tenantId)}/patients/demo-ci-patient-001/360`;
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
              G-HIMS Clinical Intelligence
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Clinical context, grounded in evidence.
            </h1>
            <p className="mt-3 max-w-3xl text-slate-300">
              A synthetic demonstration of the real Patient 360 and governed
              Clinical Intelligence workflow. Not a clinical study or patient-care system.
            </p>
          </div>
          <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-200">
            SYNTHETIC DEMO · NOT CLINICALLY VALIDATED
          </span>
        </header>

        <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
          <p className="text-xs font-bold uppercase tracking-wider text-cyan-300">Prepared synthetic case</p>
          <h2 className="mt-2 text-2xl font-semibold">Amina Shah (Synthetic)</h2>
          <p className="mt-1 text-sm text-slate-400">CI-DEMO-001 · General Medicine OPD</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Patient context', 'Hypertension and type 2 diabetes'],
              ['Medication history', 'Lisinopril and metformin'],
              ['Laboratory trend', 'Creatinine 0.9 → 1.5 mg/dL'],
              ['Additional evidence', 'Potassium 5.6 mmol/L; BP 148/92'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="mt-2 text-sm font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Link href={clinicalRecordPath}
              className="rounded-lg bg-cyan-400 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-300">
              Open live Patient 360 workspace
            </Link>
            <p className="max-w-lg text-xs text-slate-400">
              Requires a signed-in, authorized DEMO clinician or administrator and a
              separately provisioned synthetic patient. If the chart is absent, the
              demo has not yet been seeded.
            </p>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {[
            ['01 · Reconstruct', 'Open longitudinal patient history, medications, allergies, encounters and labs.'],
            ['02 · Explain', 'Generate encounter prep and trend insights, then inspect evidence provenance.'],
            ['03 · Govern', 'Review a non-authoritative clinical draft; only an authorized clinician may sign.'],
          ].map(([title, description]) => (
            <div key={title} className="rounded-xl border border-slate-700 bg-slate-900 p-5">
              <h3 className="text-base font-semibold text-cyan-200">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">{description}</p>
            </div>
          ))}
        </section>
        <p className="text-xs text-slate-500">
          Sample measurements are fabricated for demonstration. No real patients,
          clinical reference labels or verified medical outcomes are supplied.
        </p>
      </div>
    </main>
  );
}
