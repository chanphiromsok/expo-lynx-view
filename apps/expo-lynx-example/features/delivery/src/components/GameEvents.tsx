import useGameEvents from '../hooks/useGameEvents';
import EventCard from './EventCard';
import Loader from './Loader';

const GameEvents = () => {
  const { data: events, isPending, error } = useGameEvents();

  if (isPending) return <Loader />;

  if (error) return <text>Error: {error.message}</text>;

  return (
    <view className="category">
      <text className="heading">Game Events</text>

      <list
        scroll-orientation="horizontal"
        list-type="single"
        span-count={1}
        className="horizontal-list"
      >
        {events?.map((event) => {
          return (
            <list-item
              item-key={`list-item-${event.id}`}
              key={`list-item-${event.id}`}
            >
              <EventCard {...event} />
            </list-item>
          );
        })}
      </list>
    </view>
  );
};

export default GameEvents;
