import { useCallback, useEffect, useState } from "@lynx-js/react";
import { FastImage } from "lynx-fast-image";

const LIST_ID = "recyclelist";

function setAutoScroll(start: boolean) {
  lynx
    .createSelectorQuery()
    .select(`#${LIST_ID}`)
    .invoke({
      method: "autoScroll",
      params: { start, rate: "700px", autoStop: false },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      success: () => {},
      fail: () => {},
    })
    .exec();
}

/**
 * Recycling stress test for `<x-lynx-fast-image>` inside a Lynx `<list>`.
 *
 * `<list>` recycles `<list-item>` views as they scroll off/on screen, so each
 * `<FastImage>` gets torn down and re-bound to a different `source` many times.
 * This is the scenario the DoD cares about: a recycled element must never show
 * the previous cell's image. `LynxFastImageElement` handles it via
 * `onListCellPrepareForReuse` / `onListCellDisappear` (cancel + clear) plus the
 * Swift view's monotonic `loadGeneration` guard.
 *
 * Point `src/index.tsx` at `<ListDemo />` to run it.
 */

const ROWS = 80;
const ROW_H = 150;

// A pool of picsum ids; rows index into it, offset by `gen` so "shuffle" gives
// every row (visible and recycled) a brand-new source at once.
const IDS = [
  10, 20, 24, 27, 29, 33, 42, 48, 56, 60, 64, 70, 76, 83, 91, 96, 100, 106, 110,
  119, 128, 133, 142, 152, 160, 169, 175, 180, 190, 200, 210, 222, 233, 240,
  250, 260, 270, 280, 292, 300,
];

function rowSource(row: number, gen: number): string {
  const id = IDS[(row + gen * 7) % IDS.length];
  // `?g=` also busts SDWebImage's cache so a shuffle forces real reloads.
  return `https://picsum.photos/id/${id}/300/200?g=${gen}`;
}

const btn = {
  fontSize: "13px",
  color: "#0a7",
  padding: "8px 12px",
  marginRight: "8px",
  border: "1px solid #0a7",
  borderRadius: "6px",
} as const;

export function ListDemo() {
  const [gen, setGen] = useState(0);
  const [churning, setChurning] = useState(false);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    // Continuous auto-scroll drives cell recycling. Tap "churn" for the harder
    // case: recycle + full source-set swap + in-flight cancellation.
    setAutoScroll(true);
    return () => setAutoScroll(false);
  }, []);

  const toggleAuto = useCallback(() => {
    setAuto((a) => {
      setAutoScroll(!a);
      return !a;
    });
  }, []);

  const shuffle = useCallback(() => setGen((g) => g + 1), []);

  // Fire a burst of shuffles a few frames apart, so cells are recycled AND
  // source-swapped while earlier requests are still in flight.
  const churn = useCallback(() => {
    if (churning) return;
    setChurning(true);
    let n = 0;
    const tick = () => {
      n += 1;
      setGen((g) => g + 1);
      if (n < 15) setTimeout(tick, 60);
      else setChurning(false);
    };
    tick();
  }, [churning]);

  const rows = [];
  for (let i = 0; i < ROWS; i += 1) {
    rows.push(
      <list-item
        item-key={`row-${i}`}
        key={`row-${i}`}
        estimated-main-axis-size-px={ROW_H}
      >
        <view
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            height: `${ROW_H}px`,
            paddingLeft: "16px",
            paddingRight: "16px",
          }}
        >
          <FastImage
            style={{ width: "120px", height: "120px", borderRadius: "8px" }}
            source={rowSource(i, gen)}
            recyclingKey={`row-${i}-${gen}`}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <text style={{ marginLeft: "12px", fontSize: "13px" }}>
            row {i} · gen {gen}
          </text>
        </view>
      </list-item>,
    );
  }

  return (
    <view
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
      }}
    >
      <view
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          padding: "12px 16px",
        }}
      >
        <text style={{ fontSize: "15px", fontWeight: "bold", flex: 1 }}>
          list recycle · gen {gen}
        </text>
        <text style={btn} bindtap={toggleAuto}>
          {auto ? "stop" : "auto"}
        </text>
        <text style={btn} bindtap={shuffle}>
          shuffle
        </text>
        <text style={btn} bindtap={churn}>
          {churning ? "churning…" : "churn"}
        </text>
      </view>

      <list
        id={LIST_ID}
        list-type="single"
        span-count={1}
        scroll-orientation="vertical"
        style={{ flex: 1, width: "100%" }}
      >
        {rows}
      </list>
    </view>
  );
}
