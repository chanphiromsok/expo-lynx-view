import backIcon from '../assets/back.png';
import { useNavigate } from 'react-router';
import { handleTapStart, handleTapEnd } from '../utils';

const BackButton = () => {
  const nav = useNavigate();

  return (
    <view
      bindtap={() => nav(-1)}
      className="back-button"
      main-thread:bindtouchstart={handleTapStart}
      main-thread:bindtouchend={handleTapEnd}
    >
      <image src={backIcon} className="back-button-icon" />
    </view>
  );
};

export default BackButton;
