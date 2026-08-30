import { useNavigate } from 'react-router';
import DateItem from './DateItem';
import { handleTapStart, handleTapEnd, getImageUrl } from '../utils';
import type { IGameEventPreview } from '../types.ts';

const EventCard = (props: IGameEventPreview) => {
  const { id, name, event_logo, start_time } = props;
  const nav = useNavigate();

  // eslint-disable-next-line react-hooks/purity
  const isFutureDate = start_time > Math.floor(Date.now() / 1000);

  return (
    <view
      className="card fade-in-scale"
      style={{
        width: '300px',
      }}
      main-thread:bindtouchstart={handleTapStart}
      main-thread:bindtouchend={handleTapEnd}
      bindtap={() => (!isFutureDate ? nav(`/game-event/${id}`) : null)}
    >
      <image
        src={getImageUrl(event_logo.image_id)}
        className="image"
        style={{
          width: '100%',
          aspectRatio: 16 / 9,
        }}
      />

      <text className="card-title" text-maxline="2">
        {name}
      </text>

      <view
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
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

        {isFutureDate && <text className="event-status">Upcoming</text>}
      </view>
    </view>
  );
};

export default EventCard;
