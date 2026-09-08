import './App.css';
import { useNavigate } from 'react-router';
import GameEvents from './components/GameEvents';
import GameCategory from './components/GameCategory';
import Header from './components/Header';

const currentTimestamp = Math.floor(Date.now() / 1000);

const gameCategories = [
  {
    id: '1',
    title: 'Most Anticipated',
    query: `
      fields id, name, cover.image_id, first_release_date, hypes;
      where hypes > 0 & first_release_date > ${currentTimestamp};
      sort hypes desc;
      limit 20;`,
  },
  {
    id: '2',
    title: 'Recently Released',
    query: `
      fields id, name, cover.image_id, first_release_date, rating, rating_count;
      where first_release_date > ${currentTimestamp - 60 * 60 * 24 * 30 * 3};
      sort rating_count desc;
      limit 20;
      `,
  },
  {
    id: '3',
    title: 'Currently Popular',
    query: `
      fields id, name, cover.image_id, first_release_date, rating, rating_count;
      where first_release_date > ${currentTimestamp - 60 * 60 * 24 * 365}
        & rating_count > 50;
      sort rating_count desc;
      limit 20;
      `,
  },
  {
    id: '4',
    title: 'Top 20',
    query: `
      fields id, name, cover.image_id, rating, rating_count;
      where rating >= 90 & rating_count > 50;
      sort rating_count desc;
      limit 20;
      `,
  },
];

export function App() {
  const nav = useNavigate();

  return (
    <scroll-view
      scroll-orientation="vertical"
      className="scroll-container"
    >
      <view class="scroll-content">
        <Header />
        <view className="remote-release-banner">
          <text className="remote-release-eyebrow">REMOTE BUNDLE ACTIVE</text>
          <text className="remote-release-title">Hello from your iPhone update 👋</text>
          <text className="remote-release-version">Managed release · v2 · 28 Aug 2026</text>
        </view>
        <view className="batch-cta" bindtap={() => nav('/batch-tracking')}>
          <text className="batch-cta-title">View Batch Tracking</text>
          <text className="batch-cta-sub">
            100 pieces · INV260727086785 · Sok Pisey
          </text>
        </view>
        <GameEvents />
        {gameCategories.map((category) => {
          return <GameCategory title={category.title} query={category.query} />;
        })}
        <GameEvents />
        {gameCategories.map((category) => {
          return <GameCategory title={category.title} query={category.query} />;
        })}{' '}
        <GameEvents />
        {gameCategories.map((category) => {
          return <GameCategory title={category.title} query={category.query} />;
        })}
      </view>
    </scroll-view>
  );
}
