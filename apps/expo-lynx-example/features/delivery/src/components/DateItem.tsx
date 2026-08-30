import dateIcon from "../assets/date.png";

interface IDateItem {
  date: string;
}

const DateItem = (props: IDateItem) => {
  const { date } = props;

  return (
    <view className="date-container">
      <image src={dateIcon} className="date-icon" />
      <text className="date">{date}</text>
    </view>
  );
};

export default DateItem;
