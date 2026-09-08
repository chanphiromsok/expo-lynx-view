import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

import { AppsRoute } from './routes/apps';
import { HostAppRoute } from './routes/host-app';
import { MiniAppRoute } from './routes/mini-app';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

const rootRoute = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: AppsRoute,
});

const appsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/apps',
  component: AppsRoute,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/apps/$appId',
  component: HostAppRoute,
});

const miniAppRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/apps/$appId/$miniAppId',
  component: MiniAppRoute,
});

const routeTree = rootRoute.addChildren([indexRoute, appsRoute, appRoute, miniAppRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
