import { getAdminFirestore } from '../../server/firebase/admin';
import { getRuntimeMode } from '../../lib/runtime/runtime-mode';

const tenantId = String(
  process.env.GHIMS_SCM8_PROVISION_TENANT || ''
).trim().toLowerCase();
const confirmedProject = String(
  process.env.GHIMS_BOOTSTRAP_CONFIRM_PROJECT || ''
).trim();
const activeProject = String(
  process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    ''
).trim();

if (process.env.GHIMS_ALLOW_SCM8_FINANCE_PROVISION !== 'true') {
  throw new Error('SCM8_FINANCE_PROVISION_DISABLED');
}
if (!tenantId) throw new Error('SCM8_FINANCE_PROVISION_TENANT_REQUIRED');
if (!activeProject || confirmedProject !== activeProject) {
  throw new Error('SCM8_FINANCE_PROVISION_PROJECT_CONFIRMATION_MISMATCH');
}
const mode = getRuntimeMode();
if (
  mode === 'PRODUCTION' &&
  process.env.GHIMS_ALLOW_PRODUCTION_SCM8_FINANCE_PROVISION !== 'true'
) {
  throw new Error('SCM8_FINANCE_PROVISION_PRODUCTION_CONFIRMATION_REQUIRED');
}

const db = getAdminFirestore();
if (!db) throw new Error('SCM8_FINANCE_PROVISION_FIREBASE_ADMIN_UNAVAILABLE');
const accounts = db.collection('tenants').doc(tenantId).collection('accounts');

async function findByCode(code: string) {
  const snapshot = await accounts.where('accountCode','==',code).limit(2).get();
  if (snapshot.size > 1) throw new Error(`SCM8_COA_DUPLICATE_CODE:${code}`);
  return snapshot.docs[0] || null;
}

const required = await Promise.all(
  ['1210','1220','6040'].map((code)=>findByCode(code))
);
if (required.some((doc)=>!doc)) {
  throw new Error('SCM8_COA_REQUIRED_ACCOUNT_MISSING');
}
const currencies = new Set(
  required.map((doc)=>String(doc?.data().currency||'').trim().toUpperCase())
);
if (currencies.size !== 1 || [...currencies][0]?.length !== 3) {
  throw new Error('SCM8_COA_CURRENCY_MISMATCH');
}
const currency=[...currencies][0];

const existing=await findByCode('1250');
if(existing){
  const data=existing.data();
  if(
    data.category!=='asset' ||
    data.normalBalance!=='debit' ||
    data.isActive===false ||
    String(data.currency||'').trim().toUpperCase()!==currency
  ){
    throw new Error('SCM8_COA_RETURN_RECEIVABLE_INVALID');
  }
}else{
  const now=new Date().toISOString();
  await accounts.doc('scm8-1250').create({
    id:'scm8-1250',
    accountCode:'1250',
    accountName:'Supplier Returns & Credit Receivable',
    category:'asset',
    subCategory:'Current Assets',
    normalBalance:'debit',
    balance:0,
    currency,
    description:'Approved inventory returned to suppliers pending credit memo or settlement',
    isActive:true,
    isSystemLocked:true,
    tenantId,
    createdAt:now,
    updatedAt:now,
  });
}

process.stdout.write(JSON.stringify({
  success:true,runtimeMode:mode,projectId:activeProject,tenantId,currency,
  requiredAccountsVerified:['1210','1220','6040'],
  returnReceivableAccount:'1250',
  created:!existing,
},null,2)+'\n');
