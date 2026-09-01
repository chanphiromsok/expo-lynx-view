import { root } from '@lynx-js/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { App } from './App.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GameDetails from './screens/game-details';
import GameEventScreen from './screens/game-event';
import SearchScreen from './screens/search-screen';
import BatchTrackingScreen from './screens/batch-tracking';

const queryClient = new QueryClient();

root.render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <Routes>
        {/* Default landing for the demo: batch tracking. The games-list
            app lives at /batches so it's still reachable. */}
        <Route path="/" element={<BatchTrackingScreen />} />
        <Route path="/batches" element={<App />} />
        <Route path="/game-details/:id" element={<GameDetails />} />
        <Route path="/game-event/:id" element={<GameEventScreen />} />
        <Route path="/search" element={<SearchScreen />} />
        <Route path="/batch-tracking" element={<BatchTrackingScreen />} />
        <Route path="/batch-tracking/:id" element={<BatchTrackingScreen />} />
      </Routes>
    </MemoryRouter>
    ,
  </QueryClientProvider>,
);

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
