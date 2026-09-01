import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Check,
  Cloud,
  FileArchive,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
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
  type Deployment,
  type DeliveryOverview,
  type UpdateDeployment,
} from './delivery-api';

const feature = 'delivery';

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

function ConnectionScreen({
  token,
  setToken,
  onConnect,
}: {
  token: string;
  setToken: (token: string) => void;
  onConnect: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConnect();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-md shadow-xl shadow-slate-950/[0.03]">
        <CardHeader>
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Box className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="mt-3">Connect delivery console</CardTitle>
          <CardDescription>
            Enter the Worker control token to read and update the real deployment.
            The token remains in memory only and is lost on refresh.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <label className="grid gap-1.5 text-sm font-medium">
              Control token
              <input
                autoComplete="off"
                className="h-9 rounded-lg border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onChange={(event) => setToken(event.target.value)}
                placeholder="Paste CONTROL_TOKEN"
                type="password"
                value={token}
              />
            </label>
            <Button className="w-full" type="submit">Connect</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function FailureScreen({ error, onRetry, onDisconnect }: {
  error: unknown;
  onRetry: () => void;
  onDisconnect: () => void;
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
          <Button onClick={onDisconnect} variant="outline">Change token</Button>
        </div>
      </div>
    </main>
  );
}

function ConsoleHeader({ onDisconnect, onRefresh }: {
  onDisconnect: () => void;
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
        <Button onClick={onDisconnect} size="sm" variant="outline">Disconnect</Button>
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
    <Card className="shadow-xl shadow-slate-950/[0.03]">
      <CardHeader className="border-b">
        <div>
          <CardDescription>Remote deployment</CardDescription>
          <CardTitle className="mt-1 flex items-center gap-2 text-xl">
            {state}
            <Badge variant={deployment.enabled ? 'default' : 'secondary'}>
              {deployment.enabled ? 'enabled' : 'disabled'}
            </Badge>
          </CardTitle>
        </div>
        <Button
          disabled={pending || disabledWithoutBundle}
          onClick={onToggle}
          size="sm"
          variant={deployment.enabled ? 'outline' : 'default'}
        >
          {pending ? <LoaderCircle className="animate-spin" /> : null}
          {deployment.enabled ? 'Disable delivery' : 'Enable delivery'}
        </Button>
      </CardHeader>
      <CardContent className="pt-5">
        {activeBundle ? (
          <div>
            <p className="font-mono text-xs text-muted-foreground">{activeBundle.id}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{activeBundle.version}</span>
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300">
                <Check aria-hidden="true" /> Verified
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatBytes(activeBundle.archiveBytes)} · SHA-256 {shortHash(activeBundle.archiveSha256)}
            </p>
          </div>
        ) : deployment.bundleId ? (
          <div><p className="font-mono text-xs text-muted-foreground">{deployment.bundleId}</p><p className="mt-2 text-sm text-muted-foreground">This verified bundle is retained but remote delivery is disabled.</p></div>
        ) : <p className="text-sm text-muted-foreground">No verified bundle has been selected yet. Complete a CLI upload, then select it below.</p>}
        <div className="mt-6 rounded-xl border bg-muted/35 p-4 text-sm">
          <p className="font-medium">Device behavior</p>
          <p className="mt-1 text-xs text-muted-foreground">Standard promotions activate on the next feature open. A force command asks a mounted view to reload only after the bundle is verified and installed.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TrustCard() {
  return (
    <Card className="bg-[linear-gradient(145deg,oklch(0.21_0.035_258),oklch(0.16_0.025_258))] text-white shadow-xl shadow-blue-950/15">
      <CardHeader>
        <div className="grid size-9 place-items-center rounded-lg bg-white/10"><ShieldCheck className="size-5 text-blue-200" aria-hidden="true" /></div>
        <CardTitle className="mt-2 text-base text-white">Trust status</CardTitle>
        <CardDescription className="text-slate-300">Artifacts reach this list only after Worker verification.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-slate-200"><p>Worker-signed deployment</p><p>R2 object SHA-256</p><p>Immutable bundle bytes</p></CardContent>
    </Card>
  );
}

function BundleTable({ bundles, selectedId, onSelect }: {
  bundles: Bundle[];
  selectedId: string | null;
  onSelect: (bundle: Bundle) => void;
}) {
  return (
    <Card className="mt-6 overflow-hidden shadow-xl shadow-slate-950/[0.03]">
      <CardHeader className="border-b"><div><CardTitle>Verified bundles</CardTitle><CardDescription>Only bundles completed by the trusted CLI are listed here.</CardDescription></div></CardHeader>
      <CardContent className="px-0 pb-0">
        {bundles.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No verified bundles have been uploaded for this feature.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead className="pl-5">Bundle</TableHead><TableHead>Status</TableHead><TableHead className="hidden md:table-cell">Archive</TableHead><TableHead className="hidden lg:table-cell">Created</TableHead><TableHead className="w-36 text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>{bundles.map((bundle) => (
              <TableRow key={bundle.id}>
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

function ConsoleContent({ overview, pending, onToggle, onSelect }: {
  overview: DeliveryOverview;
  pending: boolean;
  onToggle: () => void;
  onSelect: (bundle: Bundle) => void;
}) {
  const activeBundle = overview.bundles.find((bundle) => bundle.status === 'active');
  return (
    <section className="mx-auto max-w-6xl px-4 py-7 sm:px-7 lg:py-9">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-2 text-sm text-muted-foreground">Deployment / {feature}</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Release delivery</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Select a verified CLI-uploaded bundle, then enable or disable remote delivery.</p></div><Badge variant="outline">Revision {overview.deployment.revision}</Badge></div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"><DeploymentCard activeBundle={activeBundle} deployment={overview.deployment} onToggle={onToggle} pending={pending} /><TrustCard /></div>
      <BundleTable bundles={overview.bundles} onSelect={onSelect} selectedId={overview.deployment.bundleId} />
    </section>
  );
}

export function DeliveryConsoleDashboard() {
  const queryClient = useQueryClient();
  const [draftToken, setDraftToken] = useState('');
  const [token, setToken] = useState('');
  const [credentialsRevision, setCredentialsRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedBundle, setSelectedBundle] = useState<Bundle | null>(null);
  const queryKey = deliveryQueryKeys.overview(feature, credentialsRevision);
  const overviewQuery = useQuery({ queryKey, queryFn: () => deliveryApi.getOverview(feature, token), enabled: token.length > 0 });
  const updateDeployment = useMutation({ mutationFn: (update: UpdateDeployment) => deliveryApi.updateDeployment(feature, token, update), onSuccess: (overview) => queryClient.setQueryData(queryKey, overview) });

  function connect() {
    const nextToken = draftToken.trim();
    if (!nextToken) return;
    setToken(nextToken);
    setCredentialsRevision((revision) => revision + 1);
    setNotice('Connected to the Worker control API.');
  }

  function disconnect() {
    setDraftToken('');
    setToken('');
    setCredentialsRevision((revision) => revision + 1);
    setSelectedBundle(null);
    setNotice(null);
  }

  function apply(update: UpdateDeployment, successMessage: string) {
    updateDeployment.mutate(update, { onSuccess: () => { setNotice(successMessage); setSelectedBundle(null); }, onError: (error) => setNotice(error instanceof Error ? error.message : 'Request failed.') });
  }

  if (!token) return <ConnectionScreen onConnect={connect} setToken={setDraftToken} token={draftToken} />;
  if (overviewQuery.isPending) return <main className="grid min-h-screen place-items-center gap-3 bg-background text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" />Loading deployment…</main>;
  if (overviewQuery.isError || !overviewQuery.data) return <FailureScreen error={overviewQuery.error} onDisconnect={disconnect} onRetry={() => void overviewQuery.refetch()} />;

  const overview = overviewQuery.data;
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_82%_-20%,rgb(59_130_246_/_20%),transparent_28rem)] bg-background text-foreground">
      <ConsoleHeader onDisconnect={disconnect} onRefresh={() => void overviewQuery.refetch()} />
      {notice && <output className="mx-auto mt-6 flex max-w-6xl items-start justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-sm text-blue-950 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-100"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice(null)} type="button"><X className="size-4" aria-hidden="true" /></button></output>}
      <ConsoleContent onSelect={(bundle) => setSelectedBundle(bundle)} onToggle={() => apply({ enabled: !overview.deployment.enabled }, overview.deployment.enabled ? 'Remote delivery disabled. Existing installed bundles stay on devices.' : 'Remote delivery enabled for the selected bundle.')} overview={overview} pending={updateDeployment.isPending} />
      <SelectionDialog bundle={selectedBundle} key={selectedBundle?.id ?? 'empty'} onClose={() => setSelectedBundle(null)} onSelect={(force) => selectedBundle && apply({ bundleId: selectedBundle.id, force }, force ? `${selectedBundle.version} selected with a forced reload request.` : `${selectedBundle.version} selected for the next feature open.`)} pending={updateDeployment.isPending} />
    </main>
  );
}
