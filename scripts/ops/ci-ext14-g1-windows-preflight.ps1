# CI-EXT-14 Windows PowerShell disposable G1 lab preflight.
# Read/list/describe only; no cloud or local CLI configuration changes.
$ErrorActionPreference = 'Stop'
$PROJECT = 'studio-1130431360-48a05'
$REGION  = 'us-central1'
$LAB_VPC = 'helixis-g1-ext14-net'

function Fail([string]$Code) {
  Write-Error "CI_EXT14_PREFLIGHT_NO_GO=$Code"
  exit 1
}
if ($env:HELIXIS_G1_PREFLIGHT_CONFIRM_PROJECT -ne $PROJECT) {
  Fail 'EXPLICIT_PROJECT_GUARD_REQUIRED'
}
$activeProject = (& gcloud config get-value project 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $activeProject -ne $PROJECT) {
  Fail 'ACTIVE_PROJECT_MISMATCH'
}
$active = & gcloud auth list '--filter=status:ACTIVE' '--format=value(account)'
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($active | Out-String))) {
  Fail 'ACTIVE_IDENTITY_REQUIRED'
}
$billing = & gcloud billing projects describe $PROJECT --format=json 2>$null
if ($LASTEXITCODE -ne 0) { Fail 'BILLING_INVENTORY_UNAVAILABLE' }
$billingState = $billing | ConvertFrom-Json
if ($billingState.billingEnabled -ne $true) { Fail 'BILLING_DISABLED' }

$apis = & gcloud services list --enabled --project=$PROJECT '--format=value(config.name)'
if ($LASTEXITCODE -ne 0) { Fail 'SERVICE_INVENTORY_UNAVAILABLE' }
$required = @(
  'run.googleapis.com','compute.googleapis.com',
  'networkservices.googleapis.com','networksecurity.googleapis.com'
)
$missing = @($required | Where-Object { $apis -notcontains $_ })
if ($missing.Count -gt 0) {
  Write-Output "MISSING_REQUIRED_APIS=$($missing -join ',')"
  Fail 'G1_APIS_NOT_ENABLED_NO_AUTOMATIC_CHANGE'
}
$existing = & gcloud compute networks describe $LAB_VPC --project=$PROJECT --format=json 2>$null
if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($existing | Out-String))) {
  Fail 'DISPOSABLE_VPC_ALREADY_EXISTS_RECONCILE_FIRST'
}
Write-Output '=== AVAILABLE REGIONAL SUBNET CIDRS (READ ONLY) ==='
& gcloud compute networks subnets list --project=$PROJECT '--format=table(name,region,ipCidrRange,network)' | Out-Host
if ($LASTEXITCODE -ne 0) { Fail 'SUBNET_INVENTORY_UNAVAILABLE' }
Write-Output '=== EXISTING REGIONAL SWP GATEWAYS (READ ONLY) ==='
& gcloud network-services gateways list --project=$PROJECT --location=$REGION '--format=table(name,routingMode,network,subnetwork)' | Out-Host
if ($LASTEXITCODE -ne 0) { Fail 'GATEWAY_INVENTORY_UNAVAILABLE' }
Write-Output '=== G1 DISPOSABLE PRE-FLIGHT ==='
Write-Output 'BILLING_ENABLED=YES'
Write-Output 'REQUIRED_APIS=ENABLED'
Write-Output "DISPOSABLE_VPC_NAME_AVAILABLE=$LAB_VPC"
Write-Output 'GCP_RESOURCE_MUTATIONS=NONE'
Write-Output 'G1_TRAFFIC_TEST=NOT_EXECUTED'
Write-Output 'G1_PRODUCTION_RELEASE=NO_GO'
