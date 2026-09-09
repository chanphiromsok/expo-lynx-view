import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  AppWindow,
  Box,
  Check,
  FileArchive,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
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
  type DeliveryOverview,
  type RegisteredApp,
  type UpdateDeployment,
} from './delivery-api';
import { MiniAppConfigCards } from './MiniAppConfigCards';

const identifier = /^[a-z][a-z0-9-]{0,63}$/;

function initialScope() {
  const params = new URLSearchParams(window.location.search);
  const appId = params.get('app') ?? '';
  const feature = params.get('feature') ?? 'delivery';
  const platform = params.get('platform') ?? 'ios';
  const runtimeVersion = params.get('runtime') ?? '';
  return {
    appId: identifier.test(appId) ? appId : '',
    feature: identifier.test(feature) ? feature : 'delivery',
    platform: platform === 'android' ? 'android' : 'ios',
    runtimeVersion,
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

function statusBadge(status: Bundle['status']) {
  return status === 'active' ? (
    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300">
      Active
    </Badge>
  ) : (
    <Badge variant="secondary">Ready</Badge>
  );
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
              <BundleTable bundles={bundles} selectedId={null} />
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

function ScopePicker({
  scopes,
  selectedScope,
  onChange,
}: {
  scopes: DeliveryScope[];
  selectedScope: DeliveryScope;
  onChange: (scope: DeliveryScope) => void;
}) {
  const platforms = [...new Set(scopes.map((scope) => scope.platform))];
  const platformScopes = scopes.filter(
    (scope) => scope.platform === selectedScope.platform,
  );

  return (
    <section className="mx-auto max-w-7xl px-4 pt-5 sm:px-7">
      <div className="grid gap-4 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-2">
        <label className="grid content-start gap-2 text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
          Platform
          <select
            aria-label="Choose platform"
            className="h-9 rounded-lg border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground"
            onChange={(event) => onChange(scopes.find((scope) => scope.platform === event.target.value) ?? selectedScope)}
            value={selectedScope.platform}
          >
            {platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
          </select>
        </label>
        <label className="grid content-start gap-2 text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
          Runtime
          <select
            aria-label="Choose runtime"
            className="h-9 rounded-lg border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground"
            onChange={(event) =>
              onChange(
                platformScopes.find(
                  (scope) => scope.runtimeVersion === event.target.value,
                ) ?? selectedScope,
              )
            }
            value={selectedScope.runtimeVersion}
          >
            {platformScopes.map((scope) => (
              <option key={scope.runtimeVersion} value={scope.runtimeVersion}>
                {scope.runtimeVersion}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function DeploymentCard({
  activeBundle,
  deployment,
  pending,
  onToggle,
}: {
  activeBundle: Bundle | undefined;
  deployment: Deployment;
  pending: boolean;
  onToggle: () => void;
}) {
  const disabledWithoutBundle = !deployment.enabled && !deployment.bundleId;
  const state =
    deployment.status === 'active'
      ? 'Enabled'
      : deployment.status === 'disabled'
        ? 'Disabled'
        : 'No selected bundle';

  return (
    <Card className="shadow-sm" size="sm">
      <CardHeader className="border-b">
        <div>
          <CardDescription>Remote deployment</CardDescription>
          <CardTitle className="mt-1 flex items-center gap-2">
            {state}
            <Badge variant={deployment.enabled ? 'default' : 'secondary'}>
              {deployment.enabled ? 'enabled' : 'disabled'}
            </Badge>
          </CardTitle>
        </div>
        <CardAction>
          <Button
            disabled={pending || disabledWithoutBundle}
            onClick={onToggle}
            size="sm"
            variant={deployment.enabled ? 'outline' : 'default'}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : null}
            {deployment.enabled ? 'Disable' : 'Enable'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">
        {activeBundle ? (
          <div>
            <p className="font-mono text-xs text-muted-foreground">
              {activeBundle.id}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{activeBundle.version}</span>
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300">
                <Check aria-hidden="true" /> Verified
              </Badge>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {formatBytes(activeBundle.archiveBytes)} · SHA-256{' '}
              {shortHash(activeBundle.archiveSha256)}
            </p>
          </div>
        ) : deployment.bundleId ? (
          <div>
            <p className="font-mono text-xs text-muted-foreground">
              {deployment.bundleId}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              This verified bundle remains selected while delivery is disabled.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Select a verified bundle from the table to prepare the deployment.
          </p>
        )}
        <p className="border-t pt-3 text-xs leading-5 text-muted-foreground">
          Standard promotions activate on the next feature open. Force reload is
          available only while selecting a bundle.
        </p>
      </CardContent>
    </Card>
  );
}

function BundleTable({
  bundles,
  selectedId,
  onSelect,
}: {
  bundles: Bundle[];
  selectedId: string | null;
  onSelect?: (bundle: Bundle) => void;
}) {
  return (
    <Card className="min-h-[28rem] shadow-sm">
      <CardHeader className="border-b">
        <div>
          <CardTitle>Verified bundles</CardTitle>
          <CardDescription>
            Choose the next deployment from CLI-uploaded releases.
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
                <TableHead className="pl-5">Bundle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Archive</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                {onSelect ? <TableHead className="w-36 text-right">Action</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {bundles.map((bundle) => (
                <TableRow
                  className={
                    bundle.id === selectedId
                      ? 'bg-primary/[0.045] hover:bg-primary/[0.07]'
                      : undefined
                  }
                  key={bundle.id}
                >
                  <TableCell className="pl-5">
                    <div className="flex items-center gap-3">
                      <div className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground">
                        <FileArchive className="size-4" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="font-medium">{bundle.version}</p>
                        <p className="mt-0.5 max-w-44 truncate font-mono text-xs text-muted-foreground sm:max-w-72">
                          {bundle.id}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{statusBadge(bundle.status)}</TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {formatBytes(bundle.archiveBytes)} ·{' '}
                    {shortHash(bundle.archiveSha256)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {formatDate(bundle.createdAt)}
                  </TableCell>
                  {onSelect ? (
                    <TableCell className="pr-4 text-right">
                      {bundle.id === selectedId ? (
                        <Badge variant="outline">Selected</Badge>
                      ) : (
                        <Button onClick={() => onSelect(bundle)} size="sm" variant="outline">
                          Select
                        </Button>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SelectionDialog({
  bundle,
  pending,
  onClose,
  onSelect,
}: {
  bundle: Bundle | null;
  pending: boolean;
  onClose: () => void;
  onSelect: (force: boolean) => void;
}) {
  const [force, setForce] = useState(false);
  return (
    <Dialog open={bundle !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Select verified bundle</DialogTitle>
          <DialogDescription>
            This changes the deployment selection. It does not enable delivery
            by itself.
          </DialogDescription>
        </DialogHeader>
        {bundle && (
          <div className="space-y-4">
            <div className="rounded-xl bg-muted p-4 font-mono text-xs leading-6">
              <p>{bundle.id}</p>
              <p>version: {bundle.version}</p>
              <p>
                archive: {formatBytes(bundle.archiveBytes)} ·{' '}
                {shortHash(bundle.archiveSha256)}
              </p>
            </div>
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
                  Use only when an installed, verified update should ask an
                  already open feature to reload now.
                </span>
              </span>
            </label>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            <X aria-hidden="true" /> Cancel
          </Button>
          <Button disabled={!bundle || pending} onClick={() => onSelect(force)}>
            {pending ? <LoaderCircle className="animate-spin" /> : null}Select
            bundle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConsoleContent({
  appId,
  feature,
  overview,
  pending,
  onToggle,
  onSelect,
}: {
  appId: string;
  feature: string;
  overview: DeliveryOverview;
  pending: boolean;
  onToggle: () => void;
  onSelect: (bundle: Bundle) => void;
}) {
  const activeBundle = overview.bundles.find(
    (bundle) => bundle.status === 'active',
  );
  const deploymentState = overview.deployment.enabled
    ? 'Remote delivery is enabled'
    : 'Remote delivery is disabled';
  return (
    <section className="mx-auto max-w-7xl px-4 py-5 sm:px-7 lg:py-7">
      <div className="mb-5 flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
            {appId} / {feature}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Release delivery
          </h1>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            runtime {overview.deployment.runtimeVersion}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge
            variant={overview.deployment.enabled ? 'default' : 'secondary'}
          >
            {deploymentState}
          </Badge>
          <Badge variant="outline">
            Revision {overview.deployment.revision}
          </Badge>
        </div>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <BundleTable
          bundles={overview.bundles}
          onSelect={onSelect}
          selectedId={overview.deployment.bundleId}
        />
        <aside className="lg:sticky lg:top-20">
          <DeploymentCard
            activeBundle={activeBundle}
            deployment={overview.deployment}
            onToggle={onToggle}
            pending={pending}
          />
        </aside>
      </div>
    </section>
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
  const [selectedBundle, setSelectedBundle] = useState<Bundle | null>(null);
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
  const selectedScope =
    selectedMiniScopes.find(
      (item) =>
        item.platform === scope.platform &&
        item.runtimeVersion === scope.runtimeVersion,
    ) ??
    selectedMiniScopes.find((item) => item.platform === scope.platform) ??
    selectedMiniScopes[0] ?? {
      appId: selectedAppId,
      feature: routeMiniAppId ?? '',
      platform: scope.platform,
      runtimeVersion: '',
    };
  const queryKey = deliveryQueryKeys.overview(
    selectedScope.appId,
    selectedScope.feature,
    selectedScope.platform,
    selectedScope.runtimeVersion,
    sessionRevision,
  );
  const overviewQuery = useQuery({
    queryKey,
    queryFn: () =>
      deliveryApi.getOverview(
        selectedScope.appId,
        selectedScope.feature,
        selectedScope.platform,
        selectedScope.runtimeVersion,
      ),
    enabled: Boolean(sessionQuery.data && selectedMiniApp && selectedScope.runtimeVersion),
    retry: false,
  });
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
      setSelectedBundle(null);
      setNotice(null);
      setSessionRevision((revision) => revision + 1);
    },
  });
  const updateDeployment = useMutation({
    mutationFn: (update: UpdateDeployment) =>
      deliveryApi.updateDeployment(
        selectedScope.appId,
        selectedScope.feature,
        selectedScope.platform,
        selectedScope.runtimeVersion,
        update,
      ),
    onSuccess: (overview) => queryClient.setQueryData(queryKey, overview),
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

  function changeScope(appId: string, feature: string, platform: 'ios' | 'android', runtimeVersion: string) {
    window.history.replaceState(
      null,
      '',
      `?app=${encodeURIComponent(appId)}&feature=${encodeURIComponent(feature)}&platform=${encodeURIComponent(platform)}&runtime=${encodeURIComponent(runtimeVersion)}`,
    );
    setScope({ appId, feature, platform, runtimeVersion });
    setNotice(null);
    setSelectedBundle(null);
  }

  function openApp(appId: string) {
    setNotice(null);
    setSelectedBundle(null);
    void navigate({ to: '/apps/$appId', params: { appId } });
  }

  function openMiniApp(appId: string, miniAppId: string) {
    const firstScope = scopes.find((item) => item.appId === appId && item.feature === miniAppId);
    setNotice(null);
    setSelectedBundle(null);
    if (firstScope) setScope(firstScope);
    void navigate({ to: '/apps/$appId/$miniAppId', params: { appId, miniAppId } });
  }

  function openApps() {
    void navigate({ to: '/apps' });
  }

  function signIn() {
    if (!username.trim() || !password) return;
    loginMutation.mutate();
  }

  function apply(update: UpdateDeployment, successMessage: string) {
    updateDeployment.mutate(update, {
      onSuccess: () => {
        setNotice(successMessage);
        setSelectedBundle(null);
      },
      onError: (error) =>
        setNotice(error instanceof Error ? error.message : 'Request failed.'),
    });
  }

  function refresh() {
    void scopesQuery.refetch();
    if (selectedScope.runtimeVersion) void overviewQuery.refetch();
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
  if (overviewQuery.isPending)
    return (
      <main className="grid min-h-screen place-items-center gap-3 bg-background text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        Loading deployment…
      </main>
    );
  if (overviewQuery.isError || !overviewQuery.data)
    return (
      <FailureScreen
        error={overviewQuery.error}
        onSignOut={() => logoutMutation.mutate()}
        onRetry={() => void overviewQuery.refetch()}
      />
    );

  const overview = overviewQuery.data;
  const currentScope: DeliveryScope = selectedScope;
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
                {selectedMiniApp.id} · Bundles
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
          <ScopePicker
            onChange={(nextScope) =>
              changeScope(
                nextScope.appId,
                nextScope.feature,
                nextScope.platform,
                nextScope.runtimeVersion,
              )
            }
            scopes={selectedMiniScopes}
            selectedScope={currentScope}
          />
          <div className="mx-auto mt-6 max-w-7xl px-4 sm:px-7">
            <MiniAppConfigCards appId={selectedApp.id} feature={selectedMiniApp.id} />
          </div>
          <ConsoleContent
            appId={selectedScope.appId}
            feature={selectedScope.feature}
            onSelect={(bundle) => setSelectedBundle(bundle)}
            onToggle={() =>
              apply(
                { enabled: !overview.deployment.enabled },
                overview.deployment.enabled
                  ? 'Remote delivery disabled. Existing installed bundles stay on devices.'
                  : 'Remote delivery enabled for the selected bundle.',
              )
            }
            overview={overview}
            pending={updateDeployment.isPending}
          />
        </div>
      </div>
      <SelectionDialog
        bundle={selectedBundle}
        key={selectedBundle?.id ?? 'empty'}
        onClose={() => setSelectedBundle(null)}
        onSelect={(force) =>
          selectedBundle &&
          apply(
            { bundleId: selectedBundle.id, force },
            force
              ? `${selectedBundle.version} selected with a forced reload request.`
              : `${selectedBundle.version} selected for the next feature open.`,
          )
        }
        pending={updateDeployment.isPending}
      />
    </main>
  );
}
