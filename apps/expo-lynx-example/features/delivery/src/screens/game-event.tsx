import { useParams } from 'react-router';
import BackButton from '../components/BackButton';
import useGameEvent from '../hooks/useGameEvent';
import Loader from '../components/Loader';
import DateItem from '../components/DateItem';
import GameList from '../components/GameList';
import { getImageUrl } from '../utils';

const GameEventScreen = () => {
  const { id } = useParams();

  const { data: event, isPending, error } = useGameEvent(id!);

  if (isPending) return <Loader />;

  if (error) return <text>Error</text>;

  const { name, description, start_time, event_logo, games } = event;

  return (
    <scroll-view className="scroll-container" scroll-orientation="vertical">
      <view
        className="scroll-content"
        style={{
          padding: '20px',
        }}
      >
        <BackButton />

        <image
          src={getImageUrl(event_logo?.image_id)}
          className="image"
          style={{
            width: '100%',
            aspectRatio: 16 / 9,
          }}
        />

        <text className="event-title" text-maxline="2">
          {name}
        </text>

        <DateItem
          date={new Date(Number(start_time) * 1000).toLocaleDateString(
            'en-US',
            {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            },
          )}
        />

        {description && <text className="summary">{description}</text>}

        <GameList games={games} />
      </view>
    </scroll-view>
  );
};

export default GameEventScreen;
