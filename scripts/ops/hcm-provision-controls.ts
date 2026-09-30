import { getAdminFirestore } from '../../server/firebase/admin';
import { getRuntimeMode } from '../../lib/runtime/runtime-mode';

const tenantId=String(process.env.GHIMS_HCM_PROVISION_TENANT||'').trim().toLowerCase();
const confirmedProject=String(process.env.GHIMS_BOOTSTRAP_CONFIRM_PROJECT||'').trim();
const activeProject=String(
  process.env.FIREBASE_PROJECT_ID||process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID||''
).trim();

if(process.env.GHIMS_ALLOW_HCM_PROVISION!=='true'){
  throw new Error('HCM_PROVISION_DISABLED: GHIMS_ALLOW_HCM_PROVISION=true is required.');
}
if(!tenantId) throw new Error('HCM_PROVISION_TENANT_REQUIRED');
if(!activeProject||confirmedProject!==activeProject){
  throw new Error('HCM_PROVISION_PROJECT_CONFIRMATION_MISMATCH');
}
if(
  getRuntimeMode()==='PRODUCTION' &&
  process.env.GHIMS_ALLOW_PRODUCTION_HCM_PROVISION!=='true'
){
  throw new Error('HCM_PROVISION_PRODUCTION_CONFIRMATION_REQUIRED');
}

const db=getAdminFirestore();
if(!db) throw new Error('HCM_PROVISION_FIREBASE_ADMIN_UNAVAILABLE');
const accounts=db.collection('tenants').doc(tenantId).collection('accounts');

async function byCode(code:string){
  const snapshot=await accounts.where('accountCode','==',code).limit(2).get();
  if(snapshot.size>1) throw new Error(`HCM_FINANCE_DUPLICATE_ACCOUNT:${code}`);
  return snapshot.docs[0]||null;
}

const bank=await byCode('1010');
if(!bank) throw new Error('HCM_FINANCE_CORE_ACCOUNT_MISSING:1010');
const currency=String(bank.data().currency||'').trim().toUpperCase();
if(currency.length!==3) throw new Error('HCM_FINANCE_CURRENCY_INVALID');

const controls=[
  {
    code:'2060',accountName:'Accrued Payroll Payable',category:'liability',
    subCategory:'Payroll Liabilities',normalBalance:'credit',
    description:'Net payroll accrued and awaiting treasury settlement'
  },
  {
    code:'2070',accountName:'Employee Payroll Tax Withholding Payable',category:'liability',
    subCategory:'Payroll Liabilities',normalBalance:'credit',
    description:'Employee statutory tax and payroll withholding liability'
  },
  {
    code:'2080',accountName:'Employee Benefits & Other Payroll Deductions Payable',category:'liability',
    subCategory:'Payroll Liabilities',normalBalance:'credit',
    description:'Benefits and other governed employee payroll deductions'
  },
  {
    code:'6510',accountName:'Salaries & Wages Expense',category:'expense',
    subCategory:'Workforce Expense',normalBalance:'debit',
    description:'Governed employee base compensation expense'
  },
  {
    code:'6520',accountName:'Overtime, On-call & Allowances Expense',category:'expense',
    subCategory:'Workforce Expense',normalBalance:'debit',
    description:'Governed overtime and recurring workforce allowance expense'
  },
] as const;

const now=new Date().toISOString();
const batch=db.batch();
const created:string[]=[];
const normalized:string[]=[];

for(const control of controls){
  const existing=await byCode(control.code);
  if(existing){
    const data=existing.data();
    if(
      String(data.category||'')!==control.category ||
      String(data.normalBalance||'')!==control.normalBalance ||
      String(data.currency||'').toUpperCase()!==currency
    ){
      throw new Error(`HCM_FINANCE_ACCOUNT_INVALID:${control.code}`);
    }
    batch.set(existing.ref,{
      accountId:existing.id,id:existing.id,tenantId,accountCode:control.code,
      accountName:control.accountName,category:control.category,
      subCategory:control.subCategory,normalBalance:control.normalBalance,
      currency,isActive:true,isSystemLocked:true,allowManualPosting:false,
      allowSupplierPayments:false,allowCashReceipts:false,
      updatedAt:now,
    },{merge:true});
    normalized.push(control.code);
    continue;
  }
  const ref=accounts.doc(`acct_${control.code}`);
  batch.set(ref,{
    accountId:ref.id,id:ref.id,tenantId,accountCode:control.code,
    accountName:control.accountName,category:control.category,
    subCategory:control.subCategory,normalBalance:control.normalBalance,
    currency,isActive:true,isSystemLocked:true,allowManualPosting:false,
    allowSupplierPayments:false,allowCashReceipts:false,
    description:control.description,createdAt:now,createdBy:'hcm-provisioner'
  });
  created.push(control.code);
}

await batch.commit();
console.log(JSON.stringify({
  tenantId,projectId:activeProject,currency,created,normalized
},null,2));
