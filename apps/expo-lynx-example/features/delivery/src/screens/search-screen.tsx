import BackButton from '../components/BackButton';
import searchIcon from '../assets/search.png';
import { useState } from '@lynx-js/react';
import useSearch from '../hooks/useSearch';
import GameCard from '../components/GameCard';
import Loader from '../components/Loader';
import { handleTapStart, handleTapEnd } from '../utils';

const SearchScreen = () => {
  const [title, setTitle] = useState('');

  const { data: games, isFetching, error, refetch } = useSearch(title);

  return (
    <view
      class="scroll-container scroll-content"
      style={{
        paddingTop: '60px',
        paddingLeft: '20px',
        paddingRight: '20px',
      }}
    >
      <BackButton />

      <view className="input-container">
        <input
          placeholder="Search games..."
          className="input"
          bindinput={(e) => setTitle(e.detail.value)}
          default-value={title}
        />

        <view
          bindtap={() => refetch()}
          className="button"
          main-thread:bindtouchstart={handleTapEnd}
          main-thread:bindtouchend={handleTapStart}
        >
          <image src={searchIcon} className="search-icon" />
        </view>
      </view>

      {isFetching && <Loader />}

      {error && <text>{error.message}</text>}

      <list
        scroll-orientation="vertical"
        list-type="flow"
        span-count={2}
        className="search-list"
      >
        {games?.map((item) => {
          return (
            <list-item
              item-key={`list-item-${item.id}`}
              key={`list-item-${item.id}`}
            >
              <GameCard {...item.game} />
            </list-item>
          );
        })}
      </list>
    </view>
  );
};

export default SearchScreen;
