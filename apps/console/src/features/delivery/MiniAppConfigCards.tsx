import { useState } from 'react';
import { Check, Code2, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function hostConfig(appId: string, feature: string) {
  const origin = window.location.hostname === '127.0.0.1' && window.location.port !== '8787'
    ? 'http://127.0.0.1:8787'
    : window.location.origin;
  const endpoint = `${origin}/v1/${appId}/${feature}`;
  return `"deliveryEndpoints": {\n  "${feature}": "${endpoint}"\n}`;
}

function miniAppConfig(appId: string, feature: string) {
  return `import { defineMiniApp } from 'expo-lynx-bundle-cli';\n\nexport default defineMiniApp({\n  appId: '${appId}',\n  feature: '${feature}',\n});`;
}

function ConfigRow({
  code,
  hint,
  label,
}: {
  code: string;
  hint: string;
  label: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
      window.setTimeout(() => setState('idle'), 2_000);
    } catch {
      setState('error');
    }
  }

  return (
    <div className="flex items-start gap-2 p-3">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs font-medium">
          {label} <span className="font-sans font-normal text-muted-foreground">— {hint}</span>
        </p>
        <pre className="mt-1.5 overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-xs leading-5 text-foreground"><code>{code}</code></pre>
      </div>
      <Button
        aria-label={state === 'error' ? `Copy ${label} failed` : `Copy ${label}`}
        onClick={() => void copy()}
        size="icon-sm"
        title={state === 'error' ? 'Copy failed' : 'Copy'}
        type="button"
        variant="ghost"
      >
        {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </div>
  );
}

/** A single button that opens a modal with both integration snippets, rather
 * than two permanently-visible cards — the config is needed once per setup,
 * not on every visit to this page. */
export function MiniAppConfigCards({ appId, feature }: { appId: string; feature: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        <Code2 aria-hidden="true" /> Integration config
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Integration config</DialogTitle>
            <DialogDescription>
              Copy these into the host app and the independent mini-app repository.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y rounded-lg border">
            <ConfigRow code={hostConfig(appId, feature)} hint="merge into the host's expo-lynx-view plugin" label="app.json" />
            <ConfigRow code={miniAppConfig(appId, feature)} hint="complete file, mini-app repo" label="lynx-miniapp.config.ts" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
