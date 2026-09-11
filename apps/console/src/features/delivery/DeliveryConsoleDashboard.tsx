import { type FormEvent, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  AppWindow,
  Box,
  ChevronRight,
  CircleCheck,
  CircleDot,
  FileArchive,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  Info,
  LoaderCircle,
  LogOut,
  Plus,
  PowerOff,
  Radio,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import {
  deliveryApi,
  deliveryQueryKeys,
  type Bundle,
  type DeliveryScope,
  type Deployment,
  type HostRuntimeSummary,
  type RegisteredApp,
  type UpdateDeployment,
} from './delivery-api';
import { MiniAppConfigCards } from './MiniAppConfigCards';

const identifier = /^[a-z][a-z0-9-]{0,63}$/;

function initialScope() {
  const params = new URLSearchParams(window.location.search);
  const appId = params.get('app') ?? '';
  const feature = params.get('feature') ?? 'delivery';
  return {
    appId: identifier.test(appId) ? appId : '',
    feature: identifier.test(feature) ? feature : 'delivery',
  };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function shortHash(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

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

function FailureScreen({
  error,
  onRetry,
  onSignOut,
}: {
  error: unknown;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-center">
      <div>
        <p className="font-medium">Could not load the deployment.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : 'The Worker did not return deployment data.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={onRetry}>Try again</Button>
          <Button onClick={onSignOut} variant="outline">
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}

function CreateHostAppDialog({
  open,
  onCreate,
  onOpenChange,
}: {
  open: boolean;
  onCreate: (input: { id: string; name: string }) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onCreate({ id, name });
      setId('');
      setName('');
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the host app.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New host app</DialogTitle>
          <DialogDescription>Register the Expo host that owns its Lynx mini apps.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">Host app ID<input className="h-10 rounded-lg border bg-background px-3" onChange={(event) => setId(event.target.value)} placeholder="bs-one" value={id} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Display name<input className="h-10 rounded-lg border bg-background px-3" onChange={(event) => setName(event.target.value)} placeholder="BS One" value={name} /></label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter className="mt-5">
            <Button disabled={!identifier.test(id) || !name.trim() || pending} type="submit">{pending ? <LoaderCircle className="animate-spin" /> : null}Create host app</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateMiniAppDialog({
  app,
  open,
  onCreate,
  onOpenChange,
}: {
  app: RegisteredApp;
  open: boolean;
  onCreate: (input: { id: string; name: string }) => Promise<unknown>;
  onOpenChange: (open: boolean) => void;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onCreate({ id, name });
      setId('');
      setName('');
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the mini app.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New mini app</DialogTitle>
          <DialogDescription>Add a mini app to {app.name}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">Mini-app ID<input className="h-10 rounded-lg border bg-background px-3" onChange={(event) => setId(event.target.value)} placeholder="merchant-home" value={id} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Display name<input className="h-10 rounded-lg border bg-background px-3" onChange={(event) => setName(event.target.value)} placeholder="Merchant Home" value={name} /></label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter className="mt-5">
            <Button disabled={!identifier.test(id) || !name.trim() || pending} type="submit">{pending ? <LoaderCircle className="animate-spin" /> : null}Create mini app</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AppRegistrationScreen({
  apps,
  onCreateApp,
  onSelectApp,
  onSignOut,
  username,
}: {
  apps: RegisteredApp[];
  onCreateApp: (input: { id: string; name: string }) => Promise<unknown>;
  onSelectApp: (appId: string) => void;
  onSignOut: () => void;
  username: string;
}) {
  const [appFilter, setAppFilter] = useState('');
  const [createHostOpen, setCreateHostOpen] = useState(false);
  const filteredApps = apps.filter((app) =>
    `${app.name} ${app.id}`.toLowerCase().includes(appFilter.trim().toLowerCase()),
  );

  return (
    <main className="min-h-screen bg-muted/35 text-foreground">
      <ConsoleHeader onRefresh={() => window.location.reload()} onSignOut={onSignOut} username={username} />
      <div className="lg:grid lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[16rem_minmax(0,1fr)]">
        <DeliverySidebar onManageApps={() => undefined} showAppsAsActive />
        <section className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-7">
          <div className="mb-7 flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-primary">Delivery</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Apps</h1>
            </div>
            <Button onClick={() => setCreateHostOpen(true)} type="button"><Plus aria-hidden="true" /> New host app</Button>
          </div>
          <Card className="shadow-sm">
            <CardHeader className="border-b max-sm:flex max-sm:flex-col max-sm:gap-3">
              <div>
                <CardTitle>Host apps</CardTitle>
                <CardDescription>Open an app to manage its mini apps and bundles.</CardDescription>
              </div>
              <CardAction className="max-sm:static max-sm:w-full max-sm:self-auto max-sm:justify-self-auto">
                <input aria-label="Filter host apps" className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-44" onChange={(event) => setAppFilter(event.target.value)} placeholder="Filter apps" value={appFilter} />
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Host app</TableHead><TableHead className="hidden text-right sm:table-cell">Mini apps</TableHead><TableHead className="w-20 text-right">Open</TableHead></TableRow></TableHeader>
                <TableBody>
                  {apps.length === 0 ? <TableRow><TableCell className="h-28 text-center text-muted-foreground" colSpan={3}>Create your first host app to get started.</TableCell></TableRow> : null}
                  {apps.length > 0 && filteredApps.length === 0 ? <TableRow><TableCell className="h-28 text-center text-muted-foreground" colSpan={3}>No host apps match “{appFilter}”.</TableCell></TableRow> : null}
                  {filteredApps.map((app) => <TableRow key={app.id}><TableCell><p className="font-medium">{app.name}</p><p className="mt-0.5 font-mono text-xs text-muted-foreground">{app.id}</p><p className="mt-1 text-xs text-muted-foreground sm:hidden">{app.miniApps.length ? `${app.miniApps.length} mini apps` : 'No mini apps'}</p></TableCell><TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">{app.miniApps.length || '—'}</TableCell><TableCell className="text-right"><Button onClick={() => onSelectApp(app.id)} size="sm" type="button" variant="outline">Open</Button></TableCell></TableRow>)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </div>
      <CreateHostAppDialog onCreate={onCreateApp} onOpenChange={setCreateHostOpen} open={createHostOpen} />
    </main>
  );
}

function DeliverySidebar({
  onManageApps,
  showAppsAsActive = false,
}: {
  onManageApps: () => void;
  showAppsAsActive?: boolean;
}) {
  return (
    <aside className="border-b bg-card lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:border-r lg:border-b-0">
      <div className="flex h-full flex-col p-3">
        <Button
          className="justify-start"
          onClick={onManageApps}
          type="button"
          variant={showAppsAsActive ? 'secondary' : 'ghost'}
        >
          <AppWindow aria-hidden="true" /> Apps
        </Button>
        <div className="mt-auto hidden border-t px-2 pt-4 text-xs leading-5 text-muted-foreground lg:block">
          Find and open a host app from the Apps directory.
        </div>
      </div>
    </aside>
  );
}

function AppDetailsScreen({
  app,
  onCreateMiniApp,
  onManageApps,
  onOpenMiniApp,
  onSignOut,
  scopes,
  username,
}: {
  app: RegisteredApp;
  onCreateMiniApp: (input: { id: string; name: string }) => Promise<unknown>;
  onManageApps: () => void;
  onOpenMiniApp: (miniAppId: string) => void;
  onSignOut: () => void;
  scopes: DeliveryScope[];
  username: string;
}) {
  const [createMiniOpen, setCreateMiniOpen] = useState(false);
  return (
    <main className="min-h-screen bg-muted/35 text-foreground">
      <ConsoleHeader
        onRefresh={() => window.location.reload()}
        onSignOut={onSignOut}
        username={username}
      />
      <div className="lg:grid lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[16rem_minmax(0,1fr)]">
        <DeliverySidebar
          onManageApps={onManageApps}
        />
        <section className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-7">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-primary">Host app</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{app.name}</h1>
              <p className="mt-2 font-mono text-xs text-muted-foreground">{app.id}</p>
            </div>
            <Button onClick={() => setCreateMiniOpen(true)} type="button"><Plus aria-hidden="true" /> New mini app</Button>
          </div>
          <Card className="mt-7 shadow-sm">
            <CardHeader className="border-b">
              <div>
                <CardTitle>Mini apps</CardTitle>
                <CardDescription>Open a mini app to view and promote its bundles.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Mini app</TableHead><TableHead className="hidden text-right sm:table-cell">Host build</TableHead><TableHead className="w-20 text-right">Open</TableHead></TableRow></TableHeader>
                <TableBody>
                  {app.miniApps.length === 0 ? <TableRow><TableCell className="h-28 text-center text-muted-foreground" colSpan={3}>Add a mini app before the host team prepares a native build.</TableCell></TableRow> : null}
                  {app.miniApps.map((miniApp) => {
                    const hasScope = scopes.some((scope) => scope.appId === app.id && scope.feature === miniApp.id);
                    return <TableRow key={miniApp.id}><TableCell><p className="font-medium">{miniApp.name}</p><p className="mt-0.5 font-mono text-xs text-muted-foreground">{miniApp.id}</p><p className="mt-1 text-xs text-muted-foreground sm:hidden">{hasScope ? 'Host build ready' : 'Waiting for host build'}</p></TableCell><TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">{hasScope ? 'Ready' : 'Waiting'}</TableCell><TableCell className="text-right"><Button onClick={() => onOpenMiniApp(miniApp.id)} size="sm" type="button" variant="outline">Open</Button></TableCell></TableRow>;
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      </div>
      <CreateMiniAppDialog app={app} onCreate={onCreateMiniApp} onOpenChange={setCreateMiniOpen} open={createMiniOpen} />
    </main>
  );
}

function EmptyMiniAppBundlesScreen({
  app,
  bundles,
  miniApp,
  onManageApps,
  onOpenApp,
  onSignOut,
  username,
}: {
  app: RegisteredApp;
  bundles: Bundle[];
  miniApp: RegisteredApp['miniApps'][number];
  onManageApps: () => void;
  onOpenApp: () => void;
  onSignOut: () => void;
  username: string;
}) {
  return (
    <main className="min-h-screen bg-muted/35 text-foreground">
      <ConsoleHeader onRefresh={() => window.location.reload()} onSignOut={onSignOut} username={username} />
      <div className="lg:grid lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[16rem_minmax(0,1fr)]">
        <DeliverySidebar onManageApps={onManageApps} />
        <section className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-7">
          <button className="text-sm font-medium text-primary" onClick={onOpenApp} type="button">{app.name}</button>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{miniApp.name}</h1>
          <p className="mt-2 font-mono text-xs text-muted-foreground">{miniApp.id}</p>
          <Card className="mt-7 max-w-2xl shadow-sm">
            <CardHeader>
              <CardTitle>{bundles.length > 0 ? 'Bundle uploaded — host build needed' : 'No verified bundles yet'}</CardTitle>
              <CardDescription>
                {bundles.length > 0
                  ? 'Register an iOS or Android host build before selecting and enabling one of these bundles for devices.'
                  : 'Upload a release with the CLI, then register an iOS or Android host build before selecting it for devices.'}
              </CardDescription>
            </CardHeader>
          </Card>
          {bundles.length > 0 ? (
            <div className="mt-4 max-w-5xl">
              <ReleaseTable bundles={bundles} onAction={() => {}} pendingKey={null} scopes={[]} />
            </div>
          ) : null}
          <div className="mt-4 max-w-5xl">
            <MiniAppConfigCards appId={app.id} feature={miniApp.id} />
          </div>
        </section>
      </div>
    </main>
  );
}

function ConsoleHeader({
  onSignOut,
  onRefresh,
  username,
}: {
  onSignOut: () => void;
  onRefresh: () => void;
  username: string;
}) {
  return (
    <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-2 border-b bg-background/85 px-3 py-2 backdrop-blur-xl sm:h-16 sm:px-6 sm:py-0">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-black/10">
          <Box className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight">Expo Lynx</p>
          <p className="hidden text-xs text-muted-foreground sm:block">Delivery Console</p>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {username}
        </span>
        <Button aria-label="Refresh" className="px-2 sm:px-3" onClick={onRefresh} size="sm" variant="outline">
          <RefreshCw aria-hidden="true" /> <span className="hidden sm:inline">Refresh</span>
        </Button>
        <Button aria-label="Sign out" className="px-2 sm:px-3" onClick={onSignOut} size="sm" variant="outline">
          <LogOut className="sm:hidden" aria-hidden="true" /><span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}

type ScopeDeployment = {
  platform: 'ios' | 'android';
  runtimeVersion: string;
  deployment: Deployment;
};

type RowActionKind = 'stage' | 'enable' | 'disable' | 'promote';

type RowAction = {
  kind: RowActionKind;
  label: string;
  /** True when this action changes what is served to devices immediately. */
  guarded: boolean;
};

/**
 * Every scope's state collapses to one of three displayed statuses per
 * release row, and exactly one valid next action from that status:
 *   off    -> stage   (bundleId change while nothing is enabled: instant)
 *          -> promote (bundleId change while something IS enabled: immediate swap, guarded)
 *   staged -> enable  (turns delivery on for the already-selected bundle: guarded)
 *   live   -> disable (stops delivery, keeps the bundle selected: guarded)
 * "Off" is never a click target: it's just how a non-selected row renders.
 */
function rowStatus(deployment: Deployment, bundleId: string): 'live' | 'staged' | 'off' {
  if (deployment.bundleId !== bundleId) return 'off';
  return deployment.enabled ? 'live' : 'staged';
}

function resolveRowAction(deployment: Deployment, bundleId: string): RowAction {
  const status = rowStatus(deployment, bundleId);
  if (status === 'live') return { kind: 'disable', label: 'Disable', guarded: true };
  if (status === 'staged') return { kind: 'enable', label: 'Enable', guarded: true };
  return deployment.enabled
    ? { kind: 'promote', label: 'Replace live', guarded: true }
    : { kind: 'stage', label: 'Stage', guarded: false };
}

function shortSha(commit: string) {
  return commit.slice(0, 7);
}

function RuntimeChips({ hostRuntimes }: { hostRuntimes: HostRuntimeSummary[] }) {
  if (hostRuntimes.length === 0) {
    return (
      <section className="mx-auto max-w-7xl px-4 pt-5 sm:px-7">
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          No native runtime is registered for this app yet. Run{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">lynx host prepare --register</code> from
          the Expo host app.
        </p>
      </section>
    );
  }
  return (
    <section className="mx-auto grid max-w-7xl gap-3 px-4 pt-5 sm:grid-cols-2 sm:px-7">
      {hostRuntimes.map((runtime) => (
        <Card className="shadow-sm" key={runtime.platform} size="sm">
          <CardContent className="pt-4">
            <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {runtime.platform} · current runtime
            </p>
            <p className="mt-1.5 break-all font-mono text-xs">{runtime.runtimeVersion}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              host <span className="font-medium text-foreground">{runtime.appVersion}</span> (build{' '}
              <span className="font-medium text-foreground">{runtime.buildNumber}</span>) · registered{' '}
              {formatDate(runtime.updatedAt)}
            </p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function PlatformCell({
  platform,
  runtimeVersion,
  deployment,
  bundleId,
  pendingKey,
  onAction,
}: {
  platform: 'ios' | 'android';
  runtimeVersion: string;
  deployment: Deployment;
  bundleId: string;
  pendingKey: string | null;
  onAction: (action: RowAction, platform: 'ios' | 'android', runtimeVersion: string, bundleId: string, deployment: Deployment) => void;
}) {
  const status = rowStatus(deployment, bundleId);
  const action = resolveRowAction(deployment, bundleId);
  const pending = pendingKey === `${platform}|${runtimeVersion}`;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Badge
        className={
          status === 'live'
            ? 'gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
            : status === 'staged'
              ? 'gap-1 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
              : 'gap-1'
        }
        variant={status === 'off' ? 'secondary' : undefined}
      >
        {status === 'live' ? <CircleCheck aria-hidden="true" /> : status === 'staged' ? <CircleDot aria-hidden="true" /> : null}
        {status === 'live' ? 'Live' : status === 'staged' ? 'Staged' : 'Off'}
      </Badge>
      <Button
        disabled={pending}
        onClick={() => onAction(action, platform, runtimeVersion, bundleId, deployment)}
        size="sm"
        variant={action.kind === 'disable' ? 'outline' : status === 'off' ? 'outline' : 'default'}
      >
        {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : action.guarded ? <ShieldAlert aria-hidden="true" /> : null}
        {action.label}
      </Button>
    </div>
  );
}

function ReleaseTable({
  bundles,
  scopes,
  pendingKey,
  onAction,
}: {
  bundles: Bundle[];
  scopes: ScopeDeployment[];
  pendingKey: string | null;
  onAction: (action: RowAction, platform: 'ios' | 'android', runtimeVersion: string, bundleId: string, deployment: Deployment) => void;
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b">
        <div>
          <CardTitle>Verified releases</CardTitle>
          <CardDescription>
            Newest first. Off &amp; Staged apply instantly — Live and disabling ask first.
          </CardDescription>
        </div>
        <CardAction>
          <Badge variant="outline">{bundles.length} releases</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {bundles.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            No verified bundles have been uploaded for this feature.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Release</TableHead>
                <TableHead className="hidden md:table-cell">Archive</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                {scopes.map((scope) => (
                  <TableHead className="text-center capitalize" key={scope.platform}>
                    {scope.platform}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {bundles.map((bundle) => {
                const liveOn = scopes.filter((scope) => scope.deployment.bundleId === bundle.id && scope.deployment.enabled);
                const divergentFrom = liveOn.length > 0
                  ? scopes.filter((scope) => scope.deployment.enabled && scope.deployment.bundleId !== bundle.id)
                  : [];
                return (
                  <TableRow className={liveOn.length > 0 ? 'bg-primary/[0.045]' : undefined} key={bundle.id}>
                    <TableCell className="pl-5 align-top">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">
                          <FileArchive className="size-4" aria-hidden="true" />
                        </div>
                        <div>
                          <p className="font-medium">{bundle.version}</p>
                          <p className="mt-0.5 max-w-52 truncate font-mono text-xs text-muted-foreground sm:max-w-80">
                            {bundle.id}
                          </p>
                          {bundle.git ? (
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <GitBranch className="size-3" aria-hidden="true" />
                                {bundle.git.branch}
                              </span>
                              <span className="inline-flex items-center gap-1 font-mono">
                                <GitCommitHorizontal className="size-3" aria-hidden="true" />
                                {shortSha(bundle.git.commit)}
                              </span>
                              <span className="max-w-64 truncate italic">{bundle.git.subject}</span>
                              {bundle.git.dirty ? (
                                <Badge className="gap-1" variant="destructive">
                                  <TriangleAlert className="size-3" aria-hidden="true" /> BUILT DIRTY
                                </Badge>
                              ) : null}
                            </div>
                          ) : null}
                          {divergentFrom.length > 0 ? (
                            <p className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                              <GitCompareArrows className="size-3" aria-hidden="true" />
                              {divergentFrom.map((scope) => scope.platform).join(', ')} live on a different release
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                      {formatBytes(bundle.archiveBytes)} · {shortHash(bundle.archiveSha256)}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {formatDate(bundle.createdAt)}
                    </TableCell>
                    {scopes.map((scope) => (
                      <TableCell className="text-center" key={scope.platform}>
                        <PlatformCell
                          bundleId={bundle.id}
                          deployment={scope.deployment}
                          onAction={onAction}
                          pendingKey={pendingKey}
                          platform={scope.platform}
                          runtimeVersion={scope.runtimeVersion}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function OlderRuntimesSection({
  groups,
  bundles,
  pendingKey,
  onAction,
}: {
  groups: ScopeDeployment[];
  bundles: Bundle[];
  pendingKey: string | null;
  onAction: (action: RowAction, platform: 'ios' | 'android', runtimeVersion: string, bundleId: string, deployment: Deployment) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <section className="mx-auto mt-5 max-w-7xl px-4 sm:px-7">
      <details className="group overflow-hidden rounded-xl border bg-card shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
          <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
          Older runtimes still in the wild
          <span className="font-normal text-muted-foreground">
            — {groups.length} runtime{groups.length === 1 ? '' : 's'} from a prior build
          </span>
        </summary>
        <div className="space-y-4 border-t p-4">
          {groups.map((group) => (
            <div key={`${group.platform}|${group.runtimeVersion}`}>
              <p className="mb-2 break-all font-mono text-xs text-muted-foreground">
                {group.platform} · {group.runtimeVersion}
              </p>
              <ReleaseTable bundles={bundles} onAction={onAction} pendingKey={pendingKey} scopes={[group]} />
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

type ConfirmAction =
  | { kind: 'enable'; platform: 'ios' | 'android'; runtimeVersion: string; bundle: Bundle; revision: number }
  | { kind: 'disable'; platform: 'ios' | 'android'; runtimeVersion: string; bundle: Bundle | undefined; revision: number }
  | { kind: 'promote'; platform: 'ios' | 'android'; runtimeVersion: string; fromBundle: Bundle | undefined; toBundle: Bundle; revision: number };

function ConfirmDialog({
  action,
  crossPlatformNote,
  pending,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction | null;
  crossPlatformNote: string | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (force: boolean) => void;
}) {
  const [force, setForce] = useState(false);
  const bundle = action?.kind === 'promote' ? action.toBundle : action?.bundle;
  const title = action?.kind === 'disable' ? 'Disable delivery?' : action?.kind === 'promote' ? 'Replace the live release?' : 'Enable delivery?';
  return (
    <Dialog onOpenChange={(open) => !open && onCancel()} open={action !== null}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {action?.kind === 'disable' ? <PowerOff aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
            {title}
          </DialogTitle>
          {action && (
            <DialogDescription className="break-all font-mono text-xs">
              {action.platform.toUpperCase()} · {action.runtimeVersion}
            </DialogDescription>
          )}
        </DialogHeader>
        {action && bundle && (
          <div className="space-y-3">
            {action.kind === 'promote' && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">{action.fromBundle?.version ?? 'no bundle'}</Badge>
                <ArrowRight aria-hidden="true" className="size-4 text-muted-foreground" />
                <Badge>{bundle.version}</Badge>
              </div>
            )}
            <div className="rounded-xl bg-muted p-4 font-mono text-xs leading-6">
              <p>{bundle.id}</p>
              <p>version: {bundle.version}</p>
              {bundle.git && (
                <p className="flex flex-wrap items-center gap-x-3">
                  <span className="inline-flex items-center gap-1"><GitBranch className="size-3" aria-hidden="true" />{bundle.git.branch}</span>
                  <span className="inline-flex items-center gap-1"><GitCommitHorizontal className="size-3" aria-hidden="true" />{shortSha(bundle.git.commit)}</span>
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">revision {action.revision} → {action.revision + 1}</p>
            {action.kind === 'disable' ? (
              <div className="flex items-start gap-2 rounded-xl border bg-muted/50 p-3 text-sm text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  Stops new downloads. Devices that already verified this bundle keep running it; devices without
                  one fall back to the embedded baseline.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <Radio aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>
                  Every device reporting {action.platform.toUpperCase()} runtime {shortHash(action.runtimeVersion)}
                  {' '}gets this bundle on the next feature open. Polling, not push.
                  {bundle.git?.dirty ? <b> This bundle was built from a dirty working tree.</b> : null}
                </span>
              </div>
            )}
            {crossPlatformNote && (
              <div className="flex items-start gap-2 rounded-xl border bg-muted/50 p-3 text-sm text-muted-foreground">
                <GitCompareArrows aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>{crossPlatformNote}</span>
              </div>
            )}
            {action.kind === 'promote' && (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm">
                <input
                  aria-label="Force mounted-view reload"
                  checked={force}
                  className="mt-0.5 size-4"
                  onChange={(event) => setForce(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  <span className="font-medium">Force mounted-view reload</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Ask features that are already open to reload as soon as the new bundle verifies.
                  </span>
                </span>
              </label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button onClick={onCancel} variant="outline">
            <X aria-hidden="true" /> Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => onConfirm(force)}
            variant={action?.kind === 'disable' ? 'outline' : 'default'}
          >
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            {action?.kind === 'disable' ? 'Disable' : action?.kind === 'promote' ? 'Replace' : 'Enable'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeliveryConsoleDashboard({
  appId: routeAppId,
  miniAppId: routeMiniAppId,
}: {
  appId?: string;
  miniAppId?: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [scope, setScope] = useState(initialScope);
  const selectedAppId = routeAppId ?? scope.appId;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sessionRevision, setSessionRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const sessionQuery = useQuery({
    queryKey: deliveryQueryKeys.session,
    queryFn: deliveryApi.getCurrentUser,
    retry: false,
    staleTime: Infinity,
  });
  const scopesQuery = useQuery({
    queryKey: deliveryQueryKeys.scopes(sessionRevision),
    queryFn: deliveryApi.getScopes,
    enabled: Boolean(sessionQuery.data),
    retry: false,
  });
  const appsQuery = useQuery({
    queryKey: ['delivery', 'apps', sessionRevision],
    queryFn: deliveryApi.getApps,
    enabled: Boolean(sessionQuery.data),
    retry: false,
  });
  const scopes = scopesQuery.data ?? [];
  const apps = appsQuery.data ?? [];
  const selectedApp = apps.find((app) => app.id === selectedAppId);
  const selectedMiniApp = selectedApp?.miniApps.find((miniApp) => miniApp.id === routeMiniAppId);
  const selectedMiniScopes = routeMiniAppId
    ? scopes.filter((item) => item.appId === selectedAppId && item.feature === routeMiniAppId)
    : [];

  // The current runtime per platform — the source of truth for which scope
  // is "current" — comes from host_runtimes (registered by `lynx host
  // register`), not from hand-picking a platform/runtime in a dropdown.
  const currentRuntimes = selectedApp?.hostRuntimes ?? [];
  const currentRuntimeKeys = new Set(currentRuntimes.map((runtime) => `${runtime.platform}|${runtime.runtimeVersion}`));
  const olderMiniScopes = selectedMiniScopes.filter((item) => !currentRuntimeKeys.has(`${item.platform}|${item.runtimeVersion}`));
  const fetchScopes = [
    ...currentRuntimes.map((runtime) => ({ platform: runtime.platform, runtimeVersion: runtime.runtimeVersion })),
    ...olderMiniScopes.map((item) => ({ platform: item.platform, runtimeVersion: item.runtimeVersion })),
  ];

  const overviewResults = useQueries({
    queries: fetchScopes.map((fetchScope) => ({
      queryKey: deliveryQueryKeys.overview(selectedAppId, routeMiniAppId ?? '', fetchScope.platform, fetchScope.runtimeVersion, sessionRevision),
      queryFn: () => deliveryApi.getOverview(selectedAppId, routeMiniAppId ?? '', fetchScope.platform, fetchScope.runtimeVersion),
      enabled: Boolean(sessionQuery.data && selectedMiniApp && fetchScope.runtimeVersion),
      retry: false,
    })),
  });
  const overviewByKey = new Map(
    fetchScopes.map((fetchScope, index) => [`${fetchScope.platform}|${fetchScope.runtimeVersion}`, overviewResults[index]?.data]),
  );
  const bundles = overviewResults.find((result) => result.data)?.data?.bundles ?? [];
  const bundlesById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
  const currentScopeDeployments: ScopeDeployment[] = currentRuntimes.flatMap((runtime) => {
    const overview = overviewByKey.get(`${runtime.platform}|${runtime.runtimeVersion}`);
    return overview ? [{ platform: runtime.platform, runtimeVersion: runtime.runtimeVersion, deployment: overview.deployment }] : [];
  });
  const olderScopeDeployments: ScopeDeployment[] = olderMiniScopes.flatMap((item) => {
    const overview = overviewByKey.get(`${item.platform}|${item.runtimeVersion}`);
    return overview ? [{ platform: item.platform, runtimeVersion: item.runtimeVersion, deployment: overview.deployment }] : [];
  });
  const overviewsPending = fetchScopes.length > 0 && overviewResults.some((result) => result.isPending);
  const erroredOverview = overviewResults.find((result) => result.isError);

  const uploadedBundlesQuery = useQuery({
    queryKey: deliveryQueryKeys.bundles(selectedAppId, routeMiniAppId ?? '', sessionRevision),
    queryFn: () => deliveryApi.getMiniAppBundles(selectedAppId, routeMiniAppId ?? ''),
    enabled: Boolean(sessionQuery.data && selectedMiniApp && routeMiniAppId && selectedMiniScopes.length === 0),
    retry: false,
  });
  const loginMutation = useMutation({
    mutationFn: () => deliveryApi.login(username.trim(), password),
    onSuccess: (session) => {
      queryClient.setQueryData(deliveryQueryKeys.session, session);
      setPassword('');
      setSessionRevision((revision) => revision + 1);
    },
  });
  const logoutMutation = useMutation({
    mutationFn: deliveryApi.logout,
    onSettled: () => {
      queryClient.removeQueries({ queryKey: deliveryQueryKeys.session });
      queryClient.removeQueries({ queryKey: ['delivery'] });
      setConfirmAction(null);
      setNotice(null);
      setSessionRevision((revision) => revision + 1);
    },
  });
  const updateDeployment = useMutation({
    mutationFn: ({ platform, runtimeVersion, update }: { platform: 'ios' | 'android'; runtimeVersion: string; update: UpdateDeployment }) =>
      deliveryApi.updateDeployment(selectedAppId, routeMiniAppId ?? '', platform, runtimeVersion, update),
    onSuccess: (overview, variables) => {
      queryClient.setQueryData(
        deliveryQueryKeys.overview(selectedAppId, routeMiniAppId ?? '', variables.platform, variables.runtimeVersion, sessionRevision),
        overview,
      );
    },
  });
  const createAppMutation = useMutation({
    mutationFn: deliveryApi.createApp,
    onSuccess: () => {
      setNotice('App registered. Add its mini apps before the host build is registered.');
      void queryClient.invalidateQueries({ queryKey: ['delivery', 'apps'] });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Could not create the app.'),
  });
  const createMiniAppMutation = useMutation({
    mutationFn: ({ appId, input }: { appId: string; input: { id: string; name: string } }) => deliveryApi.createMiniApp(appId, input),
    onSuccess: () => {
      setNotice('Mini app registered. The host team can now register a matching build.');
      void queryClient.invalidateQueries({ queryKey: ['delivery', 'apps'] });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Could not create the mini app.'),
  });

  function openApp(appId: string) {
    setNotice(null);
    setConfirmAction(null);
    void navigate({ to: '/apps/$appId', params: { appId } });
  }

  function openMiniApp(appId: string, miniAppId: string) {
    setNotice(null);
    setConfirmAction(null);
    setScope({ appId, feature: miniAppId });
    void navigate({ to: '/apps/$appId/$miniAppId', params: { appId, miniAppId } });
  }

  function openApps() {
    void navigate({ to: '/apps' });
  }

  function signIn() {
    if (!username.trim() || !password) return;
    loginMutation.mutate();
  }

  function applyDeployment(platform: 'ios' | 'android', runtimeVersion: string, update: UpdateDeployment, successMessage: string) {
    const key = `${platform}|${runtimeVersion}`;
    setPendingKey(key);
    updateDeployment.mutate(
      { platform, runtimeVersion, update },
      {
        onSuccess: () => {
          setNotice(successMessage);
          setPendingKey((current) => (current === key ? null : current));
        },
        onError: (error) => {
          setNotice(error instanceof Error ? error.message : 'Request failed.');
          setPendingKey((current) => (current === key ? null : current));
        },
      },
    );
  }

  function onRowAction(action: RowAction, platform: 'ios' | 'android', runtimeVersion: string, bundleId: string, deployment: Deployment) {
    const bundle = bundlesById.get(bundleId);
    if (!bundle) return;
    if (action.kind === 'stage') {
      applyDeployment(platform, runtimeVersion, { bundleId, force: false }, `${bundle.version} staged for the next feature open.`);
      return;
    }
    if (action.kind === 'enable') {
      setConfirmAction({ kind: 'enable', platform, runtimeVersion, bundle, revision: deployment.revision });
      return;
    }
    if (action.kind === 'disable') {
      setConfirmAction({ kind: 'disable', platform, runtimeVersion, bundle, revision: deployment.revision });
      return;
    }
    setConfirmAction({
      kind: 'promote',
      platform,
      runtimeVersion,
      fromBundle: deployment.bundleId ? bundlesById.get(deployment.bundleId) : undefined,
      toBundle: bundle,
      revision: deployment.revision,
    });
  }

  function confirmDialogSubmit(force: boolean) {
    if (!confirmAction) return;
    const { kind, platform, runtimeVersion } = confirmAction;
    if (kind === 'enable') {
      applyDeployment(platform, runtimeVersion, { enabled: true }, 'Remote delivery enabled for the selected bundle.');
    } else if (kind === 'disable') {
      applyDeployment(platform, runtimeVersion, { enabled: false }, 'Remote delivery disabled. Existing installed bundles stay on devices.');
    } else {
      applyDeployment(
        platform,
        runtimeVersion,
        { bundleId: confirmAction.toBundle.id, force },
        force
          ? `${confirmAction.toBundle.version} replaced the live release with a forced reload request.`
          : `${confirmAction.toBundle.version} replaced the live release for the next feature open.`,
      );
    }
    setConfirmAction(null);
  }

  function refresh() {
    void scopesQuery.refetch();
    void appsQuery.refetch();
    overviewResults.forEach((result) => void result.refetch());
    if (selectedMiniScopes.length === 0) void uploadedBundlesQuery.refetch();
  }

  if (sessionQuery.isPending)
    return (
      <main className="grid min-h-screen place-items-center gap-3 bg-background text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        Checking session…
      </main>
    );
  if (!sessionQuery.data)
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
  if (scopesQuery.isPending)
    return (
      <main className="grid min-h-screen place-items-center gap-3 bg-background text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        Loading deployment…
      </main>
    );
  if (scopesQuery.isError)
    return (
      <FailureScreen
        error={scopesQuery.error}
        onSignOut={() => logoutMutation.mutate()}
        onRetry={() => void scopesQuery.refetch()}
      />
    );
  if (appsQuery.isError)
    return (
      <FailureScreen
        error={appsQuery.error}
        onSignOut={() => logoutMutation.mutate()}
        onRetry={() => void appsQuery.refetch()}
      />
    );
  if (!routeAppId || !selectedApp)
    return (
      <AppRegistrationScreen
        apps={apps}
        onCreateApp={(input) => createAppMutation.mutateAsync(input)}
        onSelectApp={openApp}
        onSignOut={() => logoutMutation.mutate()}
        username={sessionQuery.data.user.username}
      />
    );
  if (!routeMiniAppId || !selectedMiniApp)
    return (
      <AppDetailsScreen
        app={selectedApp}
        onCreateMiniApp={(input) => createMiniAppMutation.mutateAsync({ appId: selectedApp.id, input })}
        onManageApps={openApps}
        onOpenMiniApp={(miniAppId) => openMiniApp(selectedApp.id, miniAppId)}
        onSignOut={() => logoutMutation.mutate()}
        scopes={scopes}
        username={sessionQuery.data.user.username}
      />
    );
  if (selectedMiniScopes.length === 0)
    if (uploadedBundlesQuery.isPending)
      return (
        <main className="grid min-h-screen place-items-center gap-3 bg-background text-sm text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          Loading uploaded bundles…
        </main>
      );
    else if (uploadedBundlesQuery.isError)
      return (
        <FailureScreen
          error={uploadedBundlesQuery.error}
          onSignOut={() => logoutMutation.mutate()}
          onRetry={() => void uploadedBundlesQuery.refetch()}
        />
      );
    else
    return (
      <EmptyMiniAppBundlesScreen
        app={selectedApp}
        bundles={uploadedBundlesQuery.data ?? []}
        miniApp={selectedMiniApp}
        onManageApps={openApps}
        onOpenApp={() => openApp(selectedApp.id)}
        onSignOut={() => logoutMutation.mutate()}
        username={sessionQuery.data.user.username}
      />
    );
  if (overviewsPending)
    return (
      <main className="grid min-h-screen place-items-center gap-3 bg-background text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        Loading deployment…
      </main>
    );
  if (erroredOverview)
    return (
      <FailureScreen
        error={erroredOverview.error}
        onSignOut={() => logoutMutation.mutate()}
        onRetry={() => void erroredOverview.refetch()}
      />
    );

  const crossPlatformNote = (() => {
    if (!confirmAction || confirmAction.kind === 'disable') return null;
    const targetBundleId = confirmAction.kind === 'promote' ? confirmAction.toBundle.id : confirmAction.bundle.id;
    const divergent = currentRuntimes.filter((runtime) => {
      if (runtime.platform === confirmAction.platform) return false;
      const overview = overviewByKey.get(`${runtime.platform}|${runtime.runtimeVersion}`);
      return !overview || overview.deployment.bundleId !== targetBundleId || !overview.deployment.enabled;
    });
    if (divergent.length === 0) return null;
    return `${divergent.map((runtime) => runtime.platform).join(', ')} will stay on a different release until you enable it there too.`;
  })();

  return (
    <main className="min-h-screen bg-muted/35 text-foreground">
      <ConsoleHeader
        onRefresh={refresh}
        onSignOut={() => logoutMutation.mutate()}
        username={sessionQuery.data.user.username}
      />
      <div className="lg:grid lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[16rem_minmax(0,1fr)]">
        <DeliverySidebar
          onManageApps={openApps}
        />
        <div className="min-w-0">
          <section className="mx-auto flex max-w-7xl items-end justify-between gap-3 px-4 pt-7 sm:px-7">
            <div>
              <button className="text-sm font-medium text-primary" onClick={() => openApp(selectedApp.id)} type="button">{selectedApp.name}</button>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                {selectedMiniApp.name}
              </h1>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {selectedMiniApp.id} · Release delivery
              </p>
            </div>
          </section>
          {notice && (
            <output className="mx-auto mt-6 flex max-w-7xl items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
              <span>{notice}</span>
              <button
                aria-label="Dismiss notice"
                onClick={() => setNotice(null)}
                type="button"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </output>
          )}
          <RuntimeChips hostRuntimes={currentRuntimes} />
          <div className="mx-auto mt-6 max-w-7xl px-4 sm:px-7">
            <MiniAppConfigCards appId={selectedApp.id} feature={selectedMiniApp.id} />
          </div>
          <section className="mx-auto mt-6 max-w-7xl px-4 sm:px-7">
            <ReleaseTable
              bundles={bundles}
              onAction={onRowAction}
              pendingKey={pendingKey}
              scopes={currentScopeDeployments}
            />
          </section>
          <OlderRuntimesSection
            bundles={bundles}
            groups={olderScopeDeployments}
            onAction={onRowAction}
            pendingKey={pendingKey}
          />
        </div>
      </div>
      <ConfirmDialog
        action={confirmAction}
        crossPlatformNote={crossPlatformNote}
        onCancel={() => setConfirmAction(null)}
        onConfirm={confirmDialogSubmit}
        pending={updateDeployment.isPending}
      />
    </main>
  );
}
