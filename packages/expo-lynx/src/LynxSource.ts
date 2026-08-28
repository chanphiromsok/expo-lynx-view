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

export type LynxErrorStage =
  'manifest' | 'signature' | 'compatibility' | 'download' | 'checksum' | 'resource' | 'lynx';

export type LynxErrorEvent = {
  feature: string;
  stage: LynxErrorStage;
  code: string;
  message: string;
};
