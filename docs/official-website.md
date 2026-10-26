# Official G-HIMS AI website

The root URL (`/`) serves the public Clinical Intelligence website to visitors.
When an authorized hospital session is restored, that same URL continues to show
the pre-existing `AuthGuard` + `TenantDashboard` application. This is intentional:
do **not** replace or bypass staff authentication for marketing traffic.

## Positioning

- **G-HIMS Clinical Intelligence** is the flagship offer: source-linked patient
  context, longitudinal changes and clinician-reviewed summaries.
- **G-HIMS OS** is the event-driven native foundation; hospitals can explore
  Clinical Intelligence without first replacing their existing systems.
- No clinical approval, regulatory clearance, live deployment or measured
  patient outcome is claimed by this website.
- The product visualization is explicitly illustrative, not sourced from a
  patient, synthetic validation cohort or live clinical environment.

## Public enquiry configuration

Set the non-secret deployment variable:

```env
NEXT_PUBLIC_GHIMS_CONTACT_EMAIL=your-verified-company-inbox@example.com
```

Use an official inbox owned and monitored by G-HIMS. Do **not** use a personal
clinical sign-in email or a fake address. The public pilot CTA uses a direct
`mailto:` link **only** when this variable is configured with a plausible
email address. Otherwise it offers a working educational anchor rather than a
broken contact form or invented booking link. This is a deployment task before
using the website for active pilot outreach.

## Release checks

1. `bun test tests/official-website-routing.test.ts`
2. `bun run typecheck`
3. `bun run lint`
4. `bun run build`
5. Browser review: desktop/mobile, light/dark user preference, keyboard navigation.
6. Anonymous `/` shows public site; existing authorized session `/` shows
   guarded dashboard; staff `/login` and tenant switching continue working.
7. Verify all clinical API, tenant isolation and offline continuity gates remain
   unchanged. Do not merge if these regress.

## Deployment notes

The official public domain has not been specified. Do not configure DNS, public
contact information, external analytics, tracking or production deployment
until separately approved. No marketing interactions persist clinical or
personal data.

Longer term, consider separate `www` and `app` origins for simpler SEO,
less Firebase bootstrapping for anonymous traffic, and stronger isolation.
That split is a separate architectural change and is **not** necessary to
review this contained landing-page PR.
