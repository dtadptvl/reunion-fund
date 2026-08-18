export const ROUTES = {
  HOME: '/',
  ACTIVITIES: '/activities',
  CONTRIBUTE: '/contribute',
  CONTRIBUTORS: '/contributors',
  EXPENSES: '/expenses',
  LOTTERY: '/lottery',
  SETTLEMENT: '/settlement',
  ADMIN: '/admin',
  LOGIN: '/login',
  REGISTER: '/register',
  VERIFY_EMAIL: '/verify-email',
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = typeof ROUTES[RouteKey];

const PATH_TO_TAB: Record<string, string> = {
  '/': 'home',
  '/activities': 'activities',
  '/contribute': 'contribute',
  '/contributors': 'contributors',
  '/expenses': 'expenses',
  '/lottery': 'lucky-wheel',
  '/lucky-wheel': 'lucky-wheel', // Alias support
  '/settlement': 'settlement',
  '/admin': 'admin',
  '/login': 'login',
  '/register': 'register',
  '/verify-email': 'verify-email',
};

const TAB_TO_PATH: Record<string, string> = {
  'home': '/',
  'activities': '/activities',
  'contribute': '/contribute',
  'contributors': '/contributors',
  'expenses': '/expenses',
  'lucky-wheel': '/lottery',
  'settlement': '/settlement',
  'admin': '/admin',
  'login': '/login',
  'register': '/register',
  'verify-email': '/verify-email',
};

/**
 * Returns the internal tab identifier corresponding to a given URL pathname.
 */
export function getTabFromPath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return PATH_TO_TAB[normalized] || 'home';
}

/**
 * Returns the canonical URL pathname for a given internal tab identifier.
 */
export function getPathFromTab(tab: string): string {
  return TAB_TO_PATH[tab] || '/';
}
