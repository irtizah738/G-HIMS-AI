/**
 * CI-EXT-18: synthetic-only Firestore transaction and security qualification.
 * Built for Node and executed only by the isolated ghims-p4-ci emulator job.
 */
import {expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {getAdminFirestore} from '@/server/firebase/admin';
import {syntheticSignedAuthorityRows} from
  '@/tests/support/ci-ext21-signed-fixtures';
import {
  proposeExternalClinicalAuthority,activateExternalClinicalAuthority,
  revokeExternalClinicalAuthority,verifyGovernanceHead,
  type AuthorityKind,
} from '@/lib/clinical/intelligence/external-authority-governance';

const roles={
  CLINICIAN:'HOSPITAL_CREDENTIAL_OFFICER',
  SITE:'HOSPITAL_INTEGRATION_OFFICER',
} as const;
const perms={
  CLINICIAN:['FHIR_CREDENTIAL_PROPOSE','FHIR_CREDENTIAL_ACTIVATE'],
  SITE:['FHIR_SITE_AUTHORITY_PROPOSE','FHIR_SITE_AUTHORITY_ACTIVATE'],
} as const;
async function fixture(){
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
    process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
    process.env.GHIMS_RUNTIME_MODE!=='TEST'||
    process.env.GHIMS_CI_EXTERNAL_AUTHORITY_GOVERNANCE_ENABLED!=='true')
    throw new Error('CI_EXT18_FIXTURE_EMULATOR_ONLY');
  const db=getAdminFirestore();
  if(!db)throw new Error('CI_EXT18_NO_EMULATOR_DB');
  const tenantId='ext18-'+randomUUID().slice(0,12);
  const root=db.collection('tenants').doc(tenantId);
  const now=Date.now();
  function actor(actorId:string,role:string,permissions:string[]){
    return {actorId,tenantId,roles:[role],permissions,facilityIds:['facility-a']};
  }
  const credentialProposer=actor('credential-proposer',
    roles.CLINICIAN,[perms.CLINICIAN[0]]);
  const credentialApprover=actor('credential-approver',
    roles.CLINICIAN,[perms.CLINICIAN[1]]);
  const siteProposer=actor('site-proposer',roles.SITE,[perms.SITE[0]]);
  const siteApprover=actor('site-approver',roles.SITE,[perms.SITE[1]]);
  const safety=actor('clinical-safety-officer','CLINICAL_SAFETY_OFFICER',
    ['FHIR_AUTHORITY_REVOKE']);
  const others=[credentialProposer,credentialApprover,siteProposer,siteApprover,safety];
  const signedGrantRows=others.map(a=>{
    const grant={
      tenantId,actorId:a.actorId,facilityIds:['facility-a'],
      roles:a.roles,permissions:a.permissions,status:'ACTIVE',
      identityAssurance:'HOSPITAL_VERIFIED',mfaStatus:'VERIFIED',
      validFrom:now-60_000,validUntil:now+900_000,revokedAt:null,
    };
    return syntheticSignedAuthorityRows({
      tenantId,facilityId:'facility-a',
      kind:'GOVERNANCE_GRANT',recordId:a.actorId,record:grant,now,
    });
  });
  const signedWrites=(signed:ReturnType<typeof syntheticSignedAuthorityRows>)=>[
    root.collection('externalClinicalIssuerAttestations')
      .doc(signed.attestationId).set(signed.attestation),
    root.collection('externalClinicalIssuerEnrollmentCommands')
      .doc(signed.attestationId).set(signed.journal),
    root.collection('externalClinicalIssuerOutbox')
      .doc(signed.attestationId).set(signed.outbox),
  ];
  await Promise.all(signedGrantRows.flatMap((signed,i)=>[
    root.collection('externalClinicalGovernanceGrants')
      .doc(others[i].actorId).set(signed.record),
    ...signedWrites(signed),
  ]));
  const sourceId='synthetic-his-source';
  const clinicianId='synthetic-clinician';
  const clinicianEvidence=syntheticSignedAuthorityRows({
    tenantId,facilityId:'facility-a',kind:'CLINICIAN',
    recordId:'evidence-clinician',now,
    record:{
      schemaVersion:1,tenantId,kind:'CLINICIAN',targetId:clinicianId,
      facilityId:'facility-a',evidenceId:'evidence-clinician',
      identityAssurance:'HOSPITAL_VERIFIED',status:'VERIFIED',
      licenseVerified:true,siteApprovalId:null,
      evidenceHash:'a'.repeat(64),verifiedByActorId:'evidence-validator',
      verifiedAt:now-1000,validFrom:now-60_000,
      validUntil:now+900_000,revokedAt:null,
    },
  });
  const siteEvidence=syntheticSignedAuthorityRows({
    tenantId,facilityId:'facility-a',kind:'SITE',
    recordId:'evidence-site',now,
    record:{
      schemaVersion:1,tenantId,kind:'SITE',targetId:sourceId,
      facilityId:'facility-a',evidenceId:'evidence-site',
      identityAssurance:'HOSPITAL_VERIFIED',status:'VERIFIED',
      licenseVerified:false,siteApprovalId:'institution-approved-site',
      evidenceHash:'b'.repeat(64),verifiedByActorId:'evidence-validator',
      verifiedAt:now-1000,validFrom:now-60_000,
      validUntil:now+900_000,revokedAt:null,
    },
  });
  await Promise.all([
    root.collection('externalClinicalAuthorityEvidence')
      .doc('evidence-clinician').set(clinicianEvidence.record),
    root.collection('externalClinicalAuthorityEvidence')
      .doc('evidence-site').set(siteEvidence.record),
    ...signedWrites(clinicianEvidence),...signedWrites(siteEvidence),
    root.collection('fhirSources').doc(sourceId).set({
      tenantId,sourceId,facilityId:'facility-a',
      siteApprovalId:'institution-approved-site',status:'ACTIVE',
      securityReviewStatus:'APPROVED',approvedResourceTypes:['Observation'],
    }),
  ]);
  function cmd(kind:AuthorityKind){
    return {kind,targetId:kind==='CLINICIAN'?clinicianId:sourceId,
      facilityId:'facility-a',
      evidenceId:kind==='CLINICIAN'?'evidence-clinician':'evidence-site',
      idempotencyKey:randomUUID()};
  }
  return {db,root,tenantId,credentialProposer,credentialApprover,
    siteProposer,siteApprover,safety,clinicianId,sourceId,now,cmd};
}

test('CI-EXT-18 dual-actor clinician authority, idempotency and safety revocation',async()=>{
  const f=await fixture();
  try{
    const command=f.cmd('CLINICIAN');
    const propose=()=>proposeExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.credentialProposer,command,
    });
    const p=await propose();
    expect(p.action).toBe('PROPOSED');
    expect(p.replay).toBe(false);
    expect((await propose()).replay).toBe(true);
    expect((await f.root.collection('externalClinicalCredentialHeads').get()).size)
      .toBe(0);
    const activation={proposalId:p.proposalId,idempotencyKey:randomUUID()};
    await expect(activateExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.credentialProposer,
      command:activation,
    })).rejects.toThrow('CI_EXT18_ACTOR_SCOPE_DENIED');
    const activate=()=>activateExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.credentialApprover,
      command:activation,
    });
    const applied=await activate();
    expect(applied.action).toBe('ACTIVATED');
    expect(applied.status).toBe('VERIFIED');
    expect(applied.clinicalUseAuthorized).toBe(false);
    expect((await activate()).replay).toBe(true);
    const headRef=f.root.collection('externalClinicalCredentialHeads')
      .doc(f.clinicianId);
    const head=await headRef.get();
    expect(head.get('licenseVerified')).toBe(true);
    expect(head.get('revision')).toBe(1);
    const event=await f.root.collection('externalClinicalAuthorityEvents')
      .doc(applied.eventId).get();
    expect(verifyGovernanceHead(head.data()||{},event.data()||{},
      applied.eventId)).toBe(true);
    await expect(activateExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.credentialApprover,
      command:{...activation,idempotencyKey:randomUUID()},
    })).rejects.toThrow('CI_EXT18_AUTHORITY_ALREADY_REGISTERED');
    const revokeCmd={
      kind:'CLINICIAN' as const,targetId:f.clinicianId,expectedRevision:1,
      idempotencyKey:randomUUID(),reasonCode:'LICENSE_WITHDRAWN' as const,
    };
    const revoke=()=>revokeExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.safety,command:revokeCmd,
    });
    const revoked=await revoke();
    expect(revoked.action).toBe('REVOKED');
    expect(revoked.revision).toBe(2);
    expect((await revoke()).replay).toBe(true);
    expect((await headRef.get()).get('status')).toBe('REVOKED');
    expect((await f.root.collection('externalClinicalAuthorityEvents').get()).size)
      .toBe(3);
    expect((await f.root.collection('externalClinicalAuthorityOutbox').get()).size)
      .toBe(3);
    expect((await f.root.collection('externalClinicalAuthorityCommands').get()).size)
      .toBe(3);
    expect((await f.root.collection('patient360Projections').get()).size).toBe(0);
  }finally{await f.db.recursiveDelete(f.root);}
},90000);

test('CI-EXT-18 source-disabled emergency site authority revocation is allowed',async()=>{
  const f=await fixture();
  try{
    const p=await proposeExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.siteProposer,
      command:f.cmd('SITE'),
    });
    const applied=await activateExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.siteApprover,
      command:{proposalId:p.proposalId,idempotencyKey:randomUUID()},
    });
    expect(applied.status).toBe('APPROVED');
    const site=f.root.collection('externalClinicalSiteAuthorityHeads')
      .doc(f.sourceId);
    expect((await site.get()).get('siteApprovalId')).toBe('institution-approved-site');
    await f.root.collection('fhirSources').doc(f.sourceId)
      .update({status:'REVOKED'});
    const command={
      kind:'SITE' as const,targetId:f.sourceId,expectedRevision:1,
      idempotencyKey:randomUUID(),reasonCode:'SOURCE_COMPROMISED' as const,
    };
    const revoked=await revokeExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.safety,command,
    });
    expect(revoked.status).toBe('REVOKED');
    expect((await site.get()).get('clinicalUseReviewStatus')).toBe('REVOKED');
    await expect(revokeExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.safety,
      command:{...command,idempotencyKey:randomUUID()},
    })).rejects.toThrow('CI_EXT18_ALREADY_REVOKED');
  }finally{await f.db.recursiveDelete(f.root);}
},90000);

test('CI-EXT-18 cannot self-attest, use revised evidence, bypass grant or reopen revoked',async()=>{
  const f=await fixture();
  try{
    const command=f.cmd('CLINICIAN');
    const forgedProposer={...f.credentialProposer,actorId:'evidence-validator'};
    await expect(proposeExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:forgedProposer,command,
    })).rejects.toThrow('CI_EXT18_CURRENT_GOVERNANCE_GRANT_REQUIRED');
    await f.root.collection('externalClinicalGovernanceGrants')
      .doc('evidence-validator').set({
        tenantId:f.tenantId,actorId:'evidence-validator',
        facilityIds:['facility-a'],roles:['HOSPITAL_CREDENTIAL_OFFICER'],
        permissions:['FHIR_CREDENTIAL_PROPOSE'],status:'ACTIVE',
        identityAssurance:'HOSPITAL_VERIFIED',mfaStatus:'VERIFIED',
        validFrom:f.now-60_000,validUntil:f.now+900_000,revokedAt:null,
      });
    await expect(proposeExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:forgedProposer,command,
    })).rejects.toThrow('CI_EXT18_INDEPENDENT_EVIDENCE_REQUIRED');
    const p=await proposeExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.credentialProposer,command,
    });
    await f.root.collection('externalClinicalAuthorityEvidence')
      .doc('evidence-clinician').update({evidenceHash:'0'.repeat(64)});
    await expect(activateExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.credentialApprover,
      command:{proposalId:p.proposalId,idempotencyKey:randomUUID()},
    })).rejects.toThrow('CI_EXT18_EVIDENCE_REVISED_OR_EXPIRED');
    await f.root.collection('externalClinicalGovernanceGrants')
      .doc(f.credentialApprover.actorId).update({status:'REVOKED'});
    await expect(activateExternalClinicalAuthority({
      db:f.db,tenantId:f.tenantId,actor:f.credentialApprover,
      command:{proposalId:p.proposalId,idempotencyKey:randomUUID()},
    })).rejects.toThrow('CI_EXT18_CURRENT_GOVERNANCE_GRANT_REQUIRED');
    expect((await f.root.collection('externalClinicalCredentialHeads').get()).size)
      .toBe(0);
    expect((await f.root.collection('externalClinicalAuthorityEvents').get()).size)
      .toBe(1);
  }finally{await f.db.recursiveDelete(f.root);}
},90000);
