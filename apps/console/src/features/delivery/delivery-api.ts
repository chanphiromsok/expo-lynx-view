export type BundleStatus = 'active' | 'ready';

export type Bundle = {
  id: string;
  appId: string;
  feature: string;
  version: string;
  runtimeVersion: string;
  archiveSha256: string;
  archiveBytes: number;
  createdAt: string;
  status: BundleStatus;
};

export type DeploymentStatus = 'active' | 'disabled' | 'empty';

export type Deployment = {
  appId: string;
  feature: string;
  runtimeVersion: string;
  bundleId: string | null;
  enabled: boolean;
  force: boolean;
  revision: number;
  updatedAt: string | null;
  status: DeploymentStatus;
};

export type DeliveryOverview = {
  deployment: Deployment;
  bundles: Bundle[];
};

export type DeliveryScope = Pick<
  Deployment,
  'appId' | 'feature' | 'runtimeVersion'
>;

export type UpdateDeployment =
  | { enabled: boolean }
  | { bundleId: string; force: boolean };

export const deliveryQueryKeys = {
  session: ['auth', 'session'] as const,
  scopes: (sessionRevision: number) =>
    ['delivery', 'scopes', sessionRevision] as const,
  overview: (
    appId: string,
    feature: string,
    runtimeVersion: string,
    sessionRevision: number,
  ) =>
    [
      'delivery',
      'overview',
      appId,
      feature,
      runtimeVersion,
      sessionRevision,
    ] as const,
};

export type ConsoleUser = {
  id: string;
  username: string;
};

export type RegisteredMiniApp = { id: string; name: string };

export type RegisteredApp = {
  id: string;
  name: string;
  currentHostBuild: { appVersion: string | null; buildNumber: string | null } | null;
  miniApps: RegisteredMiniApp[];
};

export class DeliveryApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const document = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    const message =
      document && typeof document === 'object' && 'error' in document
        ? document.error?.message
        : undefined;
    throw new DeliveryApiError(
      response.status,
      message ?? `Request failed with HTTP ${response.status}.`,
    );
  }

  return (await response.json()) as T;
}

export const deliveryApi = {
  getCurrentUser(): Promise<{ user: ConsoleUser }> {
    return request<{ user: ConsoleUser }>('/api/auth/me');
  },

  login(username: string, password: string): Promise<{ user: ConsoleUser }> {
    return request<{ user: ConsoleUser }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  },

  async logout(): Promise<void> {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok)
      throw new DeliveryApiError(
        response.status,
        `Request failed with HTTP ${response.status}.`,
      );
  },

  getOverview(
    appId: string,
    feature: string,
    runtimeVersion: string,
  ): Promise<DeliveryOverview> {
    return request<DeliveryOverview>(
      `/api/deploy/${encodeURIComponent(appId)}/${encodeURIComponent(feature)}?runtimeVersion=${encodeURIComponent(runtimeVersion)}`,
    );
  },

  getScopes(): Promise<DeliveryScope[]> {
    return request<DeliveryScope[]>('/api/deployments');
  },

  getApps(): Promise<RegisteredApp[]> {
    return request<RegisteredApp[]>('/api/apps');
  },

  createApp(input: { id: string; name: string }): Promise<{ app: RegisteredApp }> {
    return request<{ app: RegisteredApp }>('/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  createMiniApp(appId: string, input: { id: string; name: string }): Promise<{ miniApp: RegisteredMiniApp }> {
    return request<{ miniApp: RegisteredMiniApp }>(`/api/apps/${encodeURIComponent(appId)}/mini-apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  updateDeployment(
    appId: string,
    feature: string,
    runtimeVersion: string,
    update: UpdateDeployment,
  ): Promise<DeliveryOverview> {
    return request<DeliveryOverview>(
      `/api/deploy/${encodeURIComponent(appId)}/${encodeURIComponent(feature)}?runtimeVersion=${encodeURIComponent(runtimeVersion)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      },
    );
  },
};
