import { describe, it, expect } from 'vitest';
import { getTabFromPath, getPathFromTab, ROUTES } from '../../client/src/utils/routes.js';

describe('SPA Routing Helpers', () => {
  it('correctly maps all canonical pathnames to tabs', () => {
    expect(getTabFromPath('/')).toBe('home');
    expect(getTabFromPath('/activities')).toBe('activities');
    expect(getTabFromPath('/contribute')).toBe('contribute');
    expect(getTabFromPath('/contributors')).toBe('contributors');
    expect(getTabFromPath('/expenses')).toBe('expenses');
    expect(getTabFromPath('/lottery')).toBe('lucky-wheel');
    expect(getTabFromPath('/settlement')).toBe('settlement');
    expect(getTabFromPath('/admin')).toBe('admin');
    expect(getTabFromPath('/login')).toBe('login');
    expect(getTabFromPath('/register')).toBe('register');
    expect(getTabFromPath('/verify-email')).toBe('verify-email');
  });

  it('correctly maps trailing slashes and aliases', () => {
    expect(getTabFromPath('/activities/')).toBe('activities');
    expect(getTabFromPath('/lucky-wheel')).toBe('lucky-wheel');
    expect(getTabFromPath('/lucky-wheel/')).toBe('lucky-wheel');
  });

  it('falls back unknown paths to home', () => {
    expect(getTabFromPath('/unknown-path')).toBe('home');
    expect(getTabFromPath('/foo/bar')).toBe('home');
  });

  it('correctly maps all tabs back to canonical paths', () => {
    expect(getPathFromTab('home')).toBe(ROUTES.HOME);
    expect(getPathFromTab('activities')).toBe(ROUTES.ACTIVITIES);
    expect(getPathFromTab('contribute')).toBe(ROUTES.CONTRIBUTE);
    expect(getPathFromTab('contributors')).toBe(ROUTES.CONTRIBUTORS);
    expect(getPathFromTab('expenses')).toBe(ROUTES.EXPENSES);
    expect(getPathFromTab('lucky-wheel')).toBe(ROUTES.LOTTERY);
    expect(getPathFromTab('settlement')).toBe(ROUTES.SETTLEMENT);
    expect(getPathFromTab('admin')).toBe(ROUTES.ADMIN);
    expect(getPathFromTab('login')).toBe(ROUTES.LOGIN);
    expect(getPathFromTab('register')).toBe(ROUTES.REGISTER);
    expect(getPathFromTab('verify-email')).toBe(ROUTES.VERIFY_EMAIL);
  });
});
