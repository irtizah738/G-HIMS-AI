# Official G-HIMS corporate website

G-HIMS is the official parent brand and corporate website. Its flagship
product is G-HIMS CI, integrating longitudinal patient context and
clinician-reviewable intelligence with existing hospital systems. G-HIMS OS is
the native event-driven hospital operating platform.

## Public routes
Home (/); product pages (/products/clinical-intelligence and
/products/hospital-os); hospital solutions (/solutions); technology
(/technology); research (/research); company (/company); resources
(/resources); contact (/contact); privacy (/privacy); terms (/terms);
metadata (/robots.txt, /sitemap.xml, /icon.svg).

These public paths are excluded from tenant resolution in proxy.ts. The root
route retains the original authenticated dashboard behind its existing
AuthGuard. Marketing components must not import Firebase or call clinical APIs.

## Publishing prerequisites
- Configure the non-secret NEXT_PUBLIC_GHIMS_CONTACT_EMAIL with a verified
  monitored official inbox before external hospital outreach. No personal
  patient records should be sent via generic marketing email.
- Have appropriate institutional owners and legal counsel approve public
  privacy, legal, data retention, provider and jurisdiction disclosures.
- Do not invent customer logos, clinicians, study results, compliance badges,
  regulatory approvals, or testimonials.
- Change the canonical site URL only after verifying the official domain.
- Keep the established vercel.json manual-release policy. Do not enable
  automatic Git deployments before Preview isolation is qualified.

## Tests
- bun test tests/official-website-routing.test.ts
- bun run typecheck
- bun run lint
- bun run build
- bun run test:e2e with browser tooling available
- Preserve all existing security, clinical, tenant and recovery gates.

## Follow-up architecture
A separate public www origin and authenticated app origin would simplify
provider bootstrapping, SEO and clinical isolation, but is a separate migration.
No clinical authorization or session guards were removed in this project.
