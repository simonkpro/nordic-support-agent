import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetPlatformAdminCacheForTests,
  isPlatformAdminEmail,
  resolveSignInDestination,
  type MembershipSummary,
} from './workspace-auth.ts';

const ORIGINAL_ENV = process.env.PLATFORM_ADMIN_EMAILS;

afterEach(() => {
  process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_ENV;
  _resetPlatformAdminCacheForTests();
});

function setAdmins(value: string | undefined) {
  if (value === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = value;
  _resetPlatformAdminCacheForTests();
}

describe('isPlatformAdminEmail', () => {
  it('matches a listed email', () => {
    setAdmins('simon@bakersfield.ae');
    expect(isPlatformAdminEmail('simon@bakersfield.ae')).toBe(true);
  });

  it('normalises case and whitespace on both sides', () => {
    setAdmins('  Simon@Bakersfield.AE , other@example.com');
    expect(isPlatformAdminEmail('SIMON@bakersfield.ae')).toBe(true);
    expect(isPlatformAdminEmail(' other@example.com ')).toBe(true);
  });

  it('rejects unlisted emails', () => {
    setAdmins('simon@bakersfield.ae');
    expect(isPlatformAdminEmail('intruder@example.com')).toBe(false);
  });

  it('rejects everything when the env var is empty or unset', () => {
    setAdmins('');
    expect(isPlatformAdminEmail('simon@bakersfield.ae')).toBe(false);
    setAdmins(undefined);
    expect(isPlatformAdminEmail('simon@bakersfield.ae')).toBe(false);
  });

  it('rejects garbage input', () => {
    setAdmins('simon@bakersfield.ae');
    expect(isPlatformAdminEmail('')).toBe(false);
    expect(isPlatformAdminEmail('not-an-email')).toBe(false);
  });
});

function m(overrides: Partial<MembershipSummary> = {}): MembershipSummary {
  return {
    workspaceId: 'ws-1',
    workspaceName: 'Acme',
    role: 'owner',
    onboardingDone: true,
    ...overrides,
  };
}

describe('resolveSignInDestination', () => {
  it('single onboarded membership goes straight to insights', () => {
    expect(resolveSignInDestination([m()], false)).toEqual({
      activeWorkspaceId: 'ws-1',
      next: '/insights',
    });
  });

  it('single fresh membership goes to onboarding', () => {
    expect(resolveSignInDestination([m({ onboardingDone: false })], false)).toEqual({
      activeWorkspaceId: 'ws-1',
      next: '/onboarding/welcome',
    });
  });

  it('multiple memberships go to the picker with no active workspace', () => {
    const result = resolveSignInDestination([m(), m({ workspaceId: 'ws-2' })], false);
    expect(result).toEqual({ activeWorkspaceId: null, next: '/workspaces' });
  });

  it('admin with no memberships lands in /admin', () => {
    expect(resolveSignInDestination([], true)).toEqual({
      activeWorkspaceId: null,
      next: '/admin',
    });
  });

  it('admin with one membership still goes to their workspace', () => {
    expect(resolveSignInDestination([m()], true)).toEqual({
      activeWorkspaceId: 'ws-1',
      next: '/insights',
    });
  });
});
