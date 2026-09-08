import { useParams } from '@tanstack/react-router';

import { DeliveryConsoleDashboard } from '../features/delivery/DeliveryConsoleDashboard';

export function MiniAppRoute() {
  const { appId, miniAppId } = useParams({ from: '/apps/$appId/$miniAppId' });
  return <DeliveryConsoleDashboard appId={appId} miniAppId={miniAppId} />;
}
