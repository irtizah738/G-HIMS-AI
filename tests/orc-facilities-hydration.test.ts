import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = (relPath: string) => readFile(join(process.cwd(), relPath), 'utf8');

describe('ORC-8 Matrix: Facilities Hydration Coverage', () => {
  test('authorizedCollections provides beds and rooms to clinical roles', async () => {
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');

    const clinicalBlock = bootstrap.slice(
      bootstrap.indexOf("['DOCTOR', 'CONSULTANT', 'NURSE'].some"),
      bootstrap.indexOf("['RECEPTIONIST', 'REGISTRAR', 'ADMISSION_OFFICER'].some")
    );

    expect(clinicalBlock).toContain('...CLINICAL_COLLECTIONS');
    expect(clinicalBlock).toContain("add('rooms')");
  });

  test('authorizedCollections provides beds and rooms to front-desk roles', async () => {
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');

    const frontDeskBlock = bootstrap.slice(
      bootstrap.indexOf("['RECEPTIONIST', 'REGISTRAR', 'ADMISSION_OFFICER'].some"),
      bootstrap.indexOf("['EMERGENCY_NURSE', 'EMERGENCY_DOCTOR', 'ER_NURSE'")
    );

    expect(frontDeskBlock).toContain("'beds'");
    expect(frontDeskBlock).toContain("'rooms'");
    // Front desk must not receive clinical evidence
    expect(frontDeskBlock).not.toContain('...CLINICAL_COLLECTIONS');
  });

  test('authorizedCollections provides beds, rooms, and reservations to emergency roles', async () => {
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');

    const erBlock = bootstrap.slice(
      bootstrap.indexOf("['EMERGENCY_NURSE', 'EMERGENCY_DOCTOR', 'ER_NURSE'"),
      bootstrap.indexOf('// Ancillary roles never hydrate')
    );

    expect(erBlock).toContain('...CLINICAL_COLLECTIONS');
    expect(erBlock).toContain("'beds'");
    expect(erBlock).toContain("'rooms'");
    expect(erBlock).toContain("'resourceReservations'");
  });

  test('maintenance and calibration collections remain strictly administrative', async () => {
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');

    const adminBlock = bootstrap.slice(
      bootstrap.indexOf("normalized.has('SYSTEM_ADMIN')"),
      bootstrap.indexOf('const selected = new Set<string>()')
    );

    expect(adminBlock).toContain('...FACILITIES_COLLECTIONS');

    // Confirm that clinical and front-desk blocks do NOT include maintenanceWorkOrders
    const nonAdminSection = bootstrap.slice(
      bootstrap.indexOf("['DOCTOR', 'CONSULTANT', 'NURSE'].some"),
      bootstrap.indexOf('// Ancillary roles never hydrate')
    );

    expect(nonAdminSection).not.toContain('maintenanceWorkOrders');
    expect(nonAdminSection).not.toContain('calibrationRecords');
  });
});
