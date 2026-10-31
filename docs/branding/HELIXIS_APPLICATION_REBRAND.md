# Helixis AI application identity — controlled visual rebrand

## Approved naming
| Purpose | Label |
| --- | --- |
| Legal company (intended name; incorporation is separate) | Helixis Technologies, Inc. |
| Public company brand | Helixis AI |
| Flagship | Helixis Clinical Intelligence |
| Future financial product | Helixis Financial Intelligence |
| Future operations product | Helixis Operations Intelligence |
| Hospital infrastructure | Helixis Health Platform |

## What changes on this branch
- Browser metadata, installable application display name, and icon.
- App login, account recovery, facility selection, dashboard, navigation, settings, and customer-facing module labels.
- New audit PDF headings and exported spreadsheet display names.
- A shared original vector emblem visually aligned with the Helixis investor-demo mark.

## What remains unchanged
- GitHub repository name, branch topology and investor demo feature branches.
- Firebase/GCP project IDs, App Hosting and Vercel identifiers, DNS, credentials, and GitHub secrets.
- All existing tenant IDs, Firestore paths, collection names, event types, immutable audit/provenance records, outbox identifiers, API routes, runtime mode keys and existing local-storage keys.
- Security rules, RBAC/ABAC, auth flows, clinical calculations, offline storage, sync, and payment commands.
- Past evidence exports, contracts, signed reports, and retrospective qualification documentation: their original historical names are factual provenance, not active product branding.

Do **not** globally replace `G-HIMS`, `GHIMS`, or `ghims` in source code; many occurrences are persisted machine contracts or audit evidence. New product names do not imply that future products are currently released.

## Palette / visual continuity
Deep Sovereign Blue `#0B132B`; Muted Bio-Teal `#48CAE4`; Photon Cyan `#00F5D4`; Polar White `#F8F9FA`. The application SVG is original and uses the same geometry as the isolated investor demo.

## Release gate
This is a review-only branch. Require source-quality lint, typecheck, build, brand boundary test, relevant authorization/offline regression suites, and clinical demo smoke checks before considering any merge. Production promotion is a separate approval.
