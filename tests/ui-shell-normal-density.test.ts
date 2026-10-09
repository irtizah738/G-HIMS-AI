import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

describe('UI shell normal-density and accessible navigation', () => {
  test('shared shells use normal density without CSS zoom, scale or fixed desktop width', async () => {
    const globalCss = await source('app/globals.css');
    const dashboard = await source('components/tenant-dashboard.tsx');
    const tenantLayout = await source('app/[tenantId]/layout.tsx');
    expect(globalCss).toContain('html { font-size: 100%; }');
    expect(globalCss).not.toMatch(/(^|\\n)\\s*zoom\\s*:/m);
    expect(globalCss).toContain(':focus-visible');
    expect(dashboard).toContain('data-ghims-shell="dashboard"');
    expect(tenantLayout).toContain('data-ghims-shell="tenant"');
    expect(dashboard).toContain('max-w-[1600px]');
    expect(tenantLayout).toContain('max-w-[1600px]');
    expect(dashboard).toContain('h-14 flex items-center');
    expect(tenantLayout).toContain('min-h-dvh');
  });

  test('sidebar widths agree with dashboard offsets and mobile remains tappable', async () => {
    const nav = await source('components/navigation/collapsible-sidebar.tsx');
    const dashboard = await source('components/tenant-dashboard.tsx');
    expect(nav).toContain("isNavigationCollapsed ? 'w-72 sm:w-72 lg:w-16' : 'w-72 sm:w-72 lg:w-60");
    expect(nav).toContain('const isNavigationCollapsed = isCollapsed && !mobileOpen;');
    expect(dashboard).toContain("isSidebarCollapsed ? 'lg:ml-16' : 'lg:ml-60'");
    expect(nav).toContain('fixed top-0 lg:top-14');
    expect(nav).toContain('min-h-[44px] lg:min-h-[38px]');
    expect(nav).toContain('aria-pressed={isActive}');
    expect(nav).toContain('No matching modules. Try another search.');
    expect(nav).toContain("event.key === 'Escape'");
  });

  test('both navigation headers are compact and tenant choices fit narrow screens', async () => {
    const header = await source('components/tenant/tenant-shell-header.tsx');
    const dashboard = await source('components/tenant-dashboard.tsx');
    const context = await source('components/navigation/hospital-operational-context-bar.tsx');
    expect(header).toContain('h-14 flex items-center');
    expect(dashboard).toContain('h-14 flex items-center');
    expect(header).toContain('aria-expanded={dropdownOpen}');
    expect(header).toContain('aria-current={isSelected ? "true" : undefined}');
    expect(header).toContain('closeOnEscape');
    expect(header).toContain('w-[min(20rem,calc(100vw-1.5rem))]');
    expect(context).toContain('py-1.5 flex flex-wrap');
  });

  test('command hub uses compact cards while keeping clinical actions intact', async () => {
    const hub = await source('components/views/command-hub-view.tsx');
    expect(hub).toContain('space-y-4 pb-8');
    expect(hub).toContain('xl:grid-cols-4');
    expect(hub).toContain("setActiveTab('opd')");
    expect(hub).toContain("setActiveTab('beds')");
    expect(hub).toContain("setActiveTab('emergency')");
  });
});
