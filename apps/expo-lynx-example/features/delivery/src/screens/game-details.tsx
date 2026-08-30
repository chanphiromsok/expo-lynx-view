import { useParams } from 'react-router';
import useGame from '../hooks/useGame';
import ratingIcon from '../assets/rating.png';
import { useState } from '@lynx-js/react';
import Loader from '../components/Loader';
import BackButton from '../components/BackButton';
import DateItem from '../components/DateItem';
import GameList from '../components/GameList';
import { getImageUrl } from '../utils';

const GameDetails = () => {
  const { id } = useParams();

  const [maxLine, setMaxLine] = useState('5');

  const { data: game, isPending, error } = useGame(id!);

  if (isPending) return <Loader />;

  if (error) return <text>Error: {error.message}</text>;

  const {
    name,
    cover,
    rating,
    release_dates,
    summary,
    genres,
    screenshots,
    platforms,
    involved_companies,
    similar_games,
  } = game;

  return (
    <scroll-view scroll-orientation="vertical" className="scroll-container">
      <view
        className="scroll-content"
        style={{
          padding: '20px',
        }}
      >
        <BackButton />

        <image
          src={getImageUrl(cover?.image_id)}
          className="image flip-in"
          style={{
            width: '60%',
            aspectRatio: 3 / 4,
            alignSelf: 'center',
          }}
        />

        <view className="game-info">
          <text className="game-name">{name}</text>

          {rating && (
            <view className="rating-container">
              <image src={ratingIcon} className="rating-icon" />
              <text className="rating">{(rating / 10).toFixed(1)}</text>
            </view>
          )}
        </view>

        <text className="developer">
          By {involved_companies[0]?.company?.name}
        </text>

        <DateItem date={release_dates[0]?.human} />

        <text className="heading">Description</text>
        <text className="summary" text-maxline={maxLine}>
          {summary}

          <inline-truncation>
            <text bindtap={() => setMaxLine('-1')}>...See More</text>
          </inline-truncation>
        </text>

        <view className="tag-container">
          {genres?.map((genre) => (
            <text key={genre.id} className="tag">
              {genre.name}
            </text>
          ))}
        </view>

        <text className="heading">Screenshots</text>

        <list
          scroll-orientation="horizontal"
          list-type="single"
          span-count={1}
          className="horizontal-list"
        >
          {screenshots?.map((screenshot) => {
            return (
              <list-item
                item-key={`list-item-${screenshot.id}`}
                key={`list-item-${screenshot.id}`}
              >
                <image
                  src={getImageUrl(screenshot?.image_id)}
                  className="image"
                  style={{
                    width: '230px',
                    aspectRatio: 16 / 9,
                  }}
                />
              </list-item>
            );
          })}
        </list>

        <text className="heading">You can play on</text>

        <view className="tag-container">
          {platforms?.map((platform) => (
            <text key={platform.id} className="tag">
              {platform.name}
            </text>
          ))}
        </view>

        <text className="heading">You may also like</text>

        <GameList games={similar_games} />
      </view>
    </scroll-view>
  );
};

export default GameDetails;
