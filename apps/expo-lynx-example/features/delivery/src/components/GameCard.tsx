import { useNavigate } from 'react-router';
import { getImageUrl, handleTapEnd, handleTapStart } from '../utils';
import type { IGamePreview } from '../types.ts';

const GameCard = (props: IGamePreview) => {
  const { id, name, cover } = props;

  const nav = useNavigate();

  return (
    <view
      className="card fade-in-scale"
      style={{
        width: '150px',
      }}
      main-thread:bindtouchstart={handleTapStart}
      main-thread:bindtouchend={handleTapEnd}
      bindtap={() => nav(`/game-details/${id}`)}
    >
      <image
        src={getImageUrl(cover?.image_id)}
        className="image"
        style={{
          width: '100%',
          aspectRatio: 3 / 4,
        }}
      />

      <text className="card-title" text-maxline="2">
        {name}
      </text>
    </view>
  );
};

export default GameCard;
