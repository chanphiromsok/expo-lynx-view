import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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

function ConfigCard({
  code,
  description,
  title,
}: {
  code: string;
  description: string;
  title: string;
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
    <Card className="min-w-0">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
        <Button aria-label={`Copy ${title}`} onClick={() => void copy()} size="sm" type="button" variant="outline">
          {state === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {state === 'copied' ? 'Copied' : state === 'error' ? 'Copy failed' : 'Copy'}
        </Button>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-5 text-foreground"><code>{code}</code></pre>
      </CardContent>
    </Card>
  );
}

export function MiniAppConfigCards({ appId, feature }: { appId: string; feature: string }) {
  return (
    <section aria-label="Integration configuration" className="grid gap-4 lg:grid-cols-2">
      <ConfigCard
        code={hostConfig(appId, feature)}
        description="Merge this entry into the existing expo-lynx-view plugin in the host app."
        title="Host app · app.json"
      />
      <ConfigCard
        code={miniAppConfig(appId, feature)}
        description="Use this complete config file in the independent mini-app repository."
        title="Mini app · lynx-miniapp.config.ts"
      />
    </section>
  );
}
