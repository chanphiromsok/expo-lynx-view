import { type FormEvent, lazy, Suspense, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { deliveryApi, deliveryQueryKeys } from './delivery-api';

// Everything past sign-in — every screen, ReleaseTable, the confirm/create
// dialogs — lives in AuthenticatedConsole and only loads once a session
// actually exists, instead of shipping in the bundle every visitor
// downloads just to see the login form. `loadAuthenticatedConsole` is the
// one place that names the dynamic import, so the background prefetch below
// and `lazy()`'s own eventual call resolve the same cached module promise
// instead of racing two separate fetches.
function loadAuthenticatedConsole() {
  return import('./AuthenticatedConsole');
}

const AuthenticatedConsole = lazy(() =>
  loadAuthenticatedConsole().then((module) => ({ default: module.AuthenticatedConsole })),
);

function LoginScreen({
  username,
  password,
  setUsername,
  setPassword,
  pending,
  error,
  onLogin,
}: {
  username: string;
  password: string;
  setUsername: (username: string) => void;
  setPassword: (password: string) => void;
  pending: boolean;
  error: unknown;
  onLogin: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onLogin();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-md shadow-xl shadow-slate-950/[0.03]">
        <CardHeader>
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Box className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="mt-3">Sign in to delivery console</CardTitle>
          <CardDescription>
            Use your console username and password to manage the real
            deployment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <label className="grid gap-1.5 text-sm font-medium">
              Username
              <input
                autoComplete="username"
                className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Your username"
                value={username}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Password
              <input
                autoComplete="current-password"
                className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                type="password"
                value={password}
              />
            </label>
            {Boolean(error) && (
              <p className="text-sm text-destructive">
                {error instanceof Error ? error.message : 'Sign in failed.'}
              </p>
            )}
            <Button
              className="w-full"
              disabled={pending || !username.trim() || !password}
              type="submit"
            >
              {pending ? <LoaderCircle className="animate-spin" /> : null}Sign
              in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <main className="grid min-h-screen place-items-center gap-3 bg-background text-sm text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
      {label}
    </main>
  );
}

export function DeliveryConsoleDashboard({
  appId,
  miniAppId,
}: {
  appId?: string;
  miniAppId?: string;
}) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const sessionQuery = useQuery({
    queryKey: deliveryQueryKeys.session,
    queryFn: deliveryApi.getCurrentUser,
    retry: false,
    staleTime: Infinity,
  });
  // Start fetching the authenticated chunk in the background as soon as this
  // gate mounts — in parallel with the session check, well before anyone's
  // typed a password — so by the time sign-in succeeds the module is
  // already cached and the Suspense fallback never actually shows for a
  // real user going through the normal login flow.
  useEffect(() => {
    void loadAuthenticatedConsole();
  }, []);
  const loginMutation = useMutation({
    mutationFn: () => deliveryApi.login(username.trim(), password),
    onSuccess: (session) => {
      queryClient.setQueryData(deliveryQueryKeys.session, session);
      setPassword('');
    },
  });

  function signIn() {
    if (!username.trim() || !password) return;
    loginMutation.mutate();
  }

  if (sessionQuery.isPending) return <LoadingScreen label="Checking session…" />;
  if (!sessionQuery.data) {
    return (
      <LoginScreen
        error={loginMutation.error}
        onLogin={signIn}
        password={password}
        pending={loginMutation.isPending}
        setPassword={setPassword}
        setUsername={setUsername}
        username={username}
      />
    );
  }

  return (
    <Suspense fallback={<LoadingScreen label="Loading console…" />}>
      <AuthenticatedConsole appId={appId} miniAppId={miniAppId} />
    </Suspense>
  );
}
