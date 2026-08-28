# PR1 — `LynxSource` TypeScript contract

**Spec:** feature/delivery-bundle-update/specs/client/pr-01-lynx-source.md

## Goal

Introduce the typed source model. No behavior change.

## Files

- `src/LynxSource.ts` (new)
- `src/index.ts` (re-export)

## Contract

```ts
export type ActivationMode = 'on-launch' | 'next-open';

export type LynxSource =
  | { kind: 'embedded'; feature: string }
  | { kind: 'managed'; feature: string; channel?: 'stable' | 'beta'; activation?: ActivationMode }
  | { kind: 'development'; url: string };

export type LynxLoadEvent = {
  feature: string;
  version: string;
  source: 'embedded' | 'cache' | 'download';
  durationMs: number;
};

export type LynxErrorEvent = {
  feature: string;
  stage:
    | 'manifest'
    | 'signature'
    | 'compatibility'
    | 'download'
    | 'checksum'
    | 'resource'
    | 'lynx';
  code: string;
  message: string;
};
```

## Why

Every later PR consumes this type. Adding it later means touching every
file that takes a `url`.

## Acceptance criteria

- [ ] `src/LynxSource.ts` exists and exports the three types verbatim.
- [ ] `src/index.ts` re-exports all three.
- [ ] `pnpm tsc --noEmit` passes.
- [ ] Example app compiles unchanged (`url` Prop still works).
- [ ] No runtime behavior changes — render on iOS simulator with existing
      example app looks identical to before.

## Out of scope

- Switching the `url` Prop to `source` Prop (PR2).
- Native-side enforcement of `LynxSource` variants (PR2).
- Runtime changes to bundle loading (none).
