import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Check,
  Cloud,
  FileArchive,
  LoaderCircle,
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
  type UpdateDeployment,
} from './delivery-api';

const identifier = /^[a-z][a-z0-9-]{0,63}$/;

function initialScope() {
  const params = new URLSearchParams(window.location.search);
  const appId = params.get('app') ?? 'default';
  const feature = params.get('feature') ?? 'delivery';
  return { appId: identifier.test(appId) ? appId : 'default', feature: identifier.test(feature) ? feature : 'delivery' };
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
  ) : <Badge variant="secondary">Ready</Badge>;
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
            Use your console username and password to manage the real deployment.
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
            {Boolean(error) && <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Sign in failed.'}</p>}
            <Button className="w-full" disabled={pending || !username.trim() || !password} type="submit">{pending ? <LoaderCircle className="animate-spin" /> : null}Sign in</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function FailureScreen({ error, onRetry, onSignOut }: {
  error: unknown;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-center">
      <div>
        <p className="font-medium">Could not load the deployment.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : 'The Worker did not return deployment data.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={onRetry}>Try again</Button>
          <Button onClick={onSignOut} variant="outline">Sign out</Button>
        </div>
      </div>
    </main>
  );
}

function ConsoleHeader({ onSignOut, onRefresh }: {
  onSignOut: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/85 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-blue-500/20">
          <Box className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight">Expo Lynx</p>
          <p className="text-xs text-muted-foreground">Delivery Console</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge className="hidden gap-1.5 sm:inline-flex" variant="outline">
          <Cloud className="size-3" aria-hidden="true" /> Worker connected
        </Badge>
        <Button onClick={onRefresh} size="sm" variant="outline"><RefreshCw aria-hidden="true" /> Refresh</Button>
        <Button onClick={onSignOut} size="sm" variant="outline">Sign out</Button>
      </div>
    </header>
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
  const state = deployment.status === 'active'
    ? 'Enabled'
    : deployment.status === 'disabled' ? 'Disabled' : 'No selected bundle';

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
        <CardAction><Button disabled={pending || disabledWithoutBundle} onClick={onToggle} size="sm" variant={deployment.enabled ? 'outline' : 'default'}>{pending ? <LoaderCircle className="animate-spin" /> : null}{deployment.enabled ? 'Disable' : 'Enable'}</Button></CardAction>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">
        {activeBundle ? (
          <div>
            <p className="font-mono text-xs text-muted-foreground">{activeBundle.id}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{activeBundle.version}</span>
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300">
                <Check aria-hidden="true" /> Verified
              </Badge>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {formatBytes(activeBundle.archiveBytes)} · SHA-256 {shortHash(activeBundle.archiveSha256)}
            </p>
          </div>
        ) : deployment.bundleId ? (
          <div><p className="font-mono text-xs text-muted-foreground">{deployment.bundleId}</p><p className="mt-1.5 text-xs text-muted-foreground">This verified bundle remains selected while delivery is disabled.</p></div>
        ) : <p className="text-xs text-muted-foreground">Select a verified bundle from the table to prepare the deployment.</p>}
        <p className="border-t pt-3 text-xs leading-5 text-muted-foreground">Standard promotions activate on the next feature open. Force reload is available only while selecting a bundle.</p>
      </CardContent>
    </Card>
  );
}

function BundleTable({ bundles, selectedId, onSelect }: {
  bundles: Bundle[];
  selectedId: string | null;
  onSelect: (bundle: Bundle) => void;
}) {
  return (
    <Card className="min-h-[28rem] shadow-sm">
      <CardHeader className="border-b"><div><CardTitle>Verified bundles</CardTitle><CardDescription>Choose the next deployment from CLI-uploaded releases.</CardDescription></div><CardAction><Badge variant="outline">{bundles.length} releases</Badge></CardAction></CardHeader>
      <CardContent className="px-0 pb-0">
        {bundles.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No verified bundles have been uploaded for this feature.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead className="pl-5">Bundle</TableHead><TableHead>Status</TableHead><TableHead className="hidden md:table-cell">Archive</TableHead><TableHead className="hidden lg:table-cell">Created</TableHead><TableHead className="w-36 text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>{bundles.map((bundle) => (
              <TableRow className={bundle.id === selectedId ? 'bg-primary/[0.045] hover:bg-primary/[0.07]' : undefined} key={bundle.id}>
                <TableCell className="pl-5"><div className="flex items-center gap-3"><div className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><FileArchive className="size-4" aria-hidden="true" /></div><div><p className="font-medium">{bundle.version}</p><p className="mt-0.5 max-w-44 truncate font-mono text-xs text-muted-foreground sm:max-w-72">{bundle.id}</p></div></div></TableCell>
                <TableCell>{statusBadge(bundle.status)}</TableCell>
                <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">{formatBytes(bundle.archiveBytes)} · {shortHash(bundle.archiveSha256)}</TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(bundle.createdAt)}</TableCell>
                <TableCell className="pr-4 text-right">{bundle.id === selectedId ? <Badge variant="outline">Selected</Badge> : <Button onClick={() => onSelect(bundle)} size="sm" variant="outline">Select</Button>}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SelectionDialog({ bundle, pending, onClose, onSelect }: {
  bundle: Bundle | null;
  pending: boolean;
  onClose: () => void;
  onSelect: (force: boolean) => void;
}) {
  const [force, setForce] = useState(false);
  return (
    <Dialog open={bundle !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Select verified bundle</DialogTitle><DialogDescription>This changes the deployment selection. It does not enable delivery by itself.</DialogDescription></DialogHeader>
        {bundle && <div className="space-y-4"><div className="rounded-xl bg-muted p-4 font-mono text-xs leading-6"><p>{bundle.id}</p><p>version: {bundle.version}</p><p>archive: {formatBytes(bundle.archiveBytes)} · {shortHash(bundle.archiveSha256)}</p></div><label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm"><input aria-label="Force mounted-view reload" checked={force} className="mt-0.5 size-4" onChange={(event) => setForce(event.target.checked)} type="checkbox" /><span><span className="font-medium">Force mounted-view reload</span><span className="mt-0.5 block text-xs text-muted-foreground">Use only when an installed, verified update should ask an already open feature to reload now.</span></span></label></div>}
        <DialogFooter><Button onClick={onClose} variant="outline"><X aria-hidden="true" /> Cancel</Button><Button disabled={!bundle || pending} onClick={() => onSelect(force)}>{pending ? <LoaderCircle className="animate-spin" /> : null}Select bundle</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConsoleContent({ appId, feature, overview, pending, onToggle, onSelect }: {
  appId: string;
  feature: string;
  overview: DeliveryOverview;
  pending: boolean;
  onToggle: () => void;
  onSelect: (bundle: Bundle) => void;
}) {
  const activeBundle = overview.bundles.find((bundle) => bundle.status === 'active');
  const deploymentState = overview.deployment.enabled ? 'Remote delivery is enabled' : 'Remote delivery is disabled';
  return (
    <section className="mx-auto max-w-7xl px-4 py-5 sm:px-7 lg:py-7">
      <div className="mb-5 flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">{appId} / {feature}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Release delivery</h1></div><div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant={overview.deployment.enabled ? 'default' : 'secondary'}>{deploymentState}</Badge><Badge variant="outline">Revision {overview.deployment.revision}</Badge></div></div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"><BundleTable bundles={overview.bundles} onSelect={onSelect} selectedId={overview.deployment.bundleId} /><aside className="lg:sticky lg:top-20"><DeploymentCard activeBundle={activeBundle} deployment={overview.deployment} onToggle={onToggle} pending={pending} /></aside></div>
    </section>
  );
}

export function DeliveryConsoleDashboard() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState(initialScope);
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
    queryKey: deliveryQueryKeys.scopes,
    queryFn: deliveryApi.getScopes,
    enabled: Boolean(sessionQuery.data),
    retry: false,
  });
  const queryKey = deliveryQueryKeys.overview(scope.appId, scope.feature, sessionRevision);
  const overviewQuery = useQuery({
    queryKey,
    queryFn: () => deliveryApi.getOverview(scope.appId, scope.feature),
    enabled: Boolean(sessionQuery.data),
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
      queryClient.removeQueries({ queryKey: ['delivery', 'overview'] });
      setSelectedBundle(null);
      setNotice(null);
      setSessionRevision((revision) => revision + 1);
    },
  });
  const updateDeployment = useMutation({ mutationFn: (update: UpdateDeployment) => deliveryApi.updateDeployment(scope.appId, scope.feature, update), onSuccess: (overview) => queryClient.setQueryData(queryKey, overview) });

  function changeScope(appId: string, feature: string) {
    window.history.replaceState(null, '', `?app=${encodeURIComponent(appId)}&feature=${encodeURIComponent(feature)}`);
    setScope({ appId, feature });
    setNotice(null);
    setSelectedBundle(null);
  }

  function signIn() {
    if (!username.trim() || !password) return;
    loginMutation.mutate();
  }

  function apply(update: UpdateDeployment, successMessage: string) {
    updateDeployment.mutate(update, { onSuccess: () => { setNotice(successMessage); setSelectedBundle(null); }, onError: (error) => setNotice(error instanceof Error ? error.message : 'Request failed.') });
  }

  if (sessionQuery.isPending) return <main className="grid min-h-screen place-items-center gap-3 bg-background text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" />Checking session…</main>;
  if (!sessionQuery.data) return <LoginScreen error={loginMutation.error} onLogin={signIn} password={password} pending={loginMutation.isPending} setPassword={setPassword} setUsername={setUsername} username={username} />;
  if (overviewQuery.isPending) return <main className="grid min-h-screen place-items-center gap-3 bg-background text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" />Loading deployment…</main>;
  if (overviewQuery.isError || !overviewQuery.data) return <FailureScreen error={overviewQuery.error} onSignOut={() => logoutMutation.mutate()} onRetry={() => void overviewQuery.refetch()} />;

  const overview = overviewQuery.data;
  const scopes = scopesQuery.data ?? [];
  const currentScope: DeliveryScope = scope;
  const scopeOptions = scopes.some((item) => item.appId === scope.appId && item.feature === scope.feature)
    ? scopes
    : [currentScope, ...scopes];
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_82%_-20%,rgb(59_130_246_/_20%),transparent_28rem)] bg-background text-foreground">
      <ConsoleHeader onRefresh={() => void overviewQuery.refetch()} onSignOut={() => logoutMutation.mutate()} />
      {notice && <output className="mx-auto mt-6 flex max-w-6xl items-start justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-sm text-blue-950 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-100"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice(null)} type="button"><X className="size-4" aria-hidden="true" /></button></output>}
      <section className="mx-auto max-w-7xl px-4 pt-5 sm:px-7"><label className="grid max-w-sm gap-1 text-xs font-medium text-muted-foreground">App / mini app<select aria-label="Choose deployment" className="h-9 rounded-lg border bg-background px-3 text-sm text-foreground" disabled={scopesQuery.isPending} onChange={(event) => { const [appId, feature] = event.target.value.split('\u0000'); if (appId && feature) changeScope(appId, feature); }} value={`${scope.appId}\u0000${scope.feature}`}>{scopeOptions.map((item) => <option key={`${item.appId}/${item.feature}`} value={`${item.appId}\u0000${item.feature}`}>{item.appId} / {item.feature}</option>)}</select></label></section>
      <ConsoleContent appId={scope.appId} feature={scope.feature} onSelect={(bundle) => setSelectedBundle(bundle)} onToggle={() => apply({ enabled: !overview.deployment.enabled }, overview.deployment.enabled ? 'Remote delivery disabled. Existing installed bundles stay on devices.' : 'Remote delivery enabled for the selected bundle.')} overview={overview} pending={updateDeployment.isPending} />
      <SelectionDialog bundle={selectedBundle} key={selectedBundle?.id ?? 'empty'} onClose={() => setSelectedBundle(null)} onSelect={(force) => selectedBundle && apply({ bundleId: selectedBundle.id, force }, force ? `${selectedBundle.version} selected with a forced reload request.` : `${selectedBundle.version} selected for the next feature open.`)} pending={updateDeployment.isPending} />
    </main>
  );
}
