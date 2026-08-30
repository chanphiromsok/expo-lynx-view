import type { IGamePreview } from '../types.ts';
import GameCard from './GameCard';

interface IGameList {
  games: IGamePreview[];
}

const GameList = (props: IGameList) => {
  const { games } = props;

  return (
    <list
      scroll-orientation="horizontal"
      list-type="single"
      span-count={1}
      className="horizontal-list"
    >
      {games?.map((game) => {
        return (
          <list-item
            item-key={`list-item-${game.id}`}
            key={`list-item-${game.id}`}
          >
            <GameCard {...game} />
          </list-item>
        );
      })}
    </list>
  );
};

export default GameList;
