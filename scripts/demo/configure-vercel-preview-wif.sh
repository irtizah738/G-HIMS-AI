#!/usr/bin/env bash
# Provision strictly scoped, keyless Vercel PREVIEW -> GCP DEMO federation.
# Mutates IAM only in g-hims-ci-demo after explicit operator confirmation.
# Does not touch g-hims-ai, G-HIMS-OS, service-account keys, or patient data.
set -euo pipefail

project='g-hims-ci-demo'
team_slug='irtizah738s-projects'
vercel_project='g-hims-clinical-intelligence-demo'
environment='preview'
pool='ghims-ci-demo-vercel'
provider='vercel-preview'
sa_id='ghims-ci-demo-preview'
issuer="https://oidc.vercel.com/${team_slug}"
audience="https://vercel.com/${team_slug}"
subject="owner:${team_slug}:project:${vercel_project}:environment:${environment}"

command -v gcloud >/dev/null || { echo 'ERROR: gcloud is required' >&2; exit 1; }
if [[ "$(gcloud config get-value project 2>/dev/null)" != "$project" ]] ||
   [[ "${DEVSHELL_PROJECT_ID:-}" != "$project" ]]; then
  echo "ERROR: active Cloud Shell and gcloud project must both be $project" >&2
  exit 1
fi
project_number="$(gcloud projects describe "$project" --format='value(projectNumber)')"
if [[ ! "$project_number" =~ ^[0-9]+$ ]]; then
  echo 'ERROR: unable to verify DEMO project number' >&2
  exit 1
fi
sa_email="${sa_id}@${project}.iam.gserviceaccount.com"
principal="principal://iam.googleapis.com/projects/${project_number}/locations/global/workloadIdentityPools/${pool}/subject/${subject}"

echo "Firebase DEMO project: $project (#$project_number)"
echo "Vercel token issuer: $issuer"
echo "Vercel allowed audience: $audience"
echo "Allowed exact OIDC subject: $subject"
echo "Service account: $sa_email"
echo 'IAM permissions to add only in demo project: roles/datastore.user, roles/firebaseauth.viewer.'
echo 'No Firebase Auth administrator privileges and NO service account private keys.'
echo
read -r -p "Type exact approval '$project/$environment': " confirm
if [[ "$confirm" != "$project/$environment" ]]; then
  echo 'ERROR: identity setup not authorized' >&2
  exit 1
fi

gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$project"

if ! gcloud iam workload-identity-pools describe "$pool" \
   --project="$project" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$pool" \
    --project="$project" --location=global \
    --display-name="G-HIMS CI DEMO Vercel (preview only)"
fi

if ! gcloud iam workload-identity-pools providers describe "$provider" \
   --project="$project" --location=global \
   --workload-identity-pool="$pool" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$provider" \
    --project="$project" --location=global \
    --workload-identity-pool="$pool" \
    --display-name="Vercel investor demo preview" \
    --issuer-uri="$issuer" \
    --allowed-audiences="$audience" \
    --attribute-mapping="google.subject=assertion.sub" \
    --attribute-condition="assertion.sub == '$subject'"
fi

if ! gcloud iam service-accounts describe "$sa_email" --project="$project" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$sa_id" --project="$project" \
    --display-name="G-HIMS CI DEMO preview read/write Firestore"
fi

# These roles are limited to this DEMO project, not the production Firebase project.
# The hosted app needs Firestore operations but only read-only Auth user lookup.
for role in roles/datastore.user roles/firebaseauth.viewer; do
  gcloud projects add-iam-policy-binding "$project" \
    --member="serviceAccount:$sa_email" --role="$role" --condition=None >/dev/null
done

# No wildcard principalSet: only a matching Vercel project + preview token
# may impersonate this DEMO service account.
gcloud iam service-accounts add-iam-policy-binding "$sa_email" \
  --project="$project" \
  --member="$principal" \
  --role='roles/iam.workloadIdentityUser' >/dev/null

echo "CI_DEMO_WIF_POOL=$pool"
echo "CI_DEMO_WIF_PROVIDER=$provider"
echo "CI_DEMO_GCP_PROJECT_NUMBER=$project_number"
echo "CI_DEMO_SERVICE_ACCOUNT_EMAIL=$sa_email"
echo "CI_DEMO_EXPECTED_VERCEL_SUBJECT=$subject"
echo 'CI_DEMO_WIF_IAM_CONFIGURED=PASS'
echo 'NEXT: configure a client-library-compatible OIDC subject-token source for the deployed Vercel Functions, then run an authenticated end-to-end test.'
