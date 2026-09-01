export type BundleStatus = 'active' | 'ready';

export type Bundle = {
  id: string;
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
  feature: string;
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

export type UpdateDeployment =
  | { enabled: boolean }
  | { bundleId: string; force: boolean };

export const deliveryQueryKeys = {
  overview: (feature: string, credentialsRevision: number) =>
    ['delivery', 'overview', feature, credentialsRevision] as const,
};

export class DeliveryApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const document = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
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
  getOverview(feature: string, token: string): Promise<DeliveryOverview> {
    return request<DeliveryOverview>(
      `/api/deploy/${encodeURIComponent(feature)}`,
      token,
    );
  },

  updateDeployment(
    feature: string,
    token: string,
    update: UpdateDeployment,
  ): Promise<DeliveryOverview> {
    return request<DeliveryOverview>(
      `/api/deploy/${encodeURIComponent(feature)}`,
      token,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      },
    );
  },
};
