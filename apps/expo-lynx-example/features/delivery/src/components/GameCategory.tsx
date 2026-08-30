import useGameQuery from '../hooks/useGameQuery';
import GameList from './GameList';
import Loader from './Loader';

interface IGameCategory {
  title: string;
  query: string;
}

const GameCategory = (props: IGameCategory) => {
  const { title, query } = props;

  const { data: games, isPending, error } = useGameQuery(query);

  if (isPending) return <Loader />;

  if (error) return <text>Error: {error.message}</text>;

  return (
    <view className="category">
      <text className="heading">{title}</text>

      <GameList games={games} />
    </view>
  );
};

export default GameCategory;
