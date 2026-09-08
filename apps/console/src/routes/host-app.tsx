import { useParams } from '@tanstack/react-router';

import { DeliveryConsoleDashboard } from '../features/delivery/DeliveryConsoleDashboard';

export function HostAppRoute() {
  const { appId } = useParams({ from: '/apps/$appId' });
  return <DeliveryConsoleDashboard appId={appId} />;
}
