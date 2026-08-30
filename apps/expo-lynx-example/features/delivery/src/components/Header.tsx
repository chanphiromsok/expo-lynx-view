import { useNavigate } from 'react-router';
import logo from '../assets/logo.png';
import searchIcon from '../assets/search.png';

const Header = () => {
  const nav = useNavigate();

  return (
    <view className="header">
      <image src={logo} className="logo" />

      <image
        src={searchIcon}
        className="icon-big"
        bindtap={() => nav('/search')}
      />
    </view>
  );
};

export default Header;
