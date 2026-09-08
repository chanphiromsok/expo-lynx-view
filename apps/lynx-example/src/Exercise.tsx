import { useCallback, useState, type ReactNode } from "@lynx-js/react";
import { FastImage } from "lynx-fast-image";

/**
 * Full manual exercise for `<x-lynx-fast-image>`:
 * JPEG / PNG / WebP / animated GIF, placeholder→final, transition, blurRadius,
 * tintColor, large-source downsampling, and rapid source swap.
 *
 * Point `src/index.tsx` at `<Exercise />` instead of `<App />` to run it.
 */

function Case(props: { title: string; note?: string; children: ReactNode }) {
  return (
    <view
      style={{ display: "flex", flexDirection: "column", marginBottom: "20px" }}
    >
      <text style={{ fontSize: "13px", fontWeight: "bold" }}>
        {props.title}
      </text>
      {props.note ? (
        <text style={{ fontSize: "11px", color: "#888", marginBottom: "4px" }}>
          {props.note}
        </text>
      ) : null}
      {props.children}
    </view>
  );
}

const BOX = { width: "240px", height: "160px" } as const;

// Reliable, CORS-open test assets.
const JPEG = "https://picsum.photos/id/1015/480/320";
const JPEG_ALT = "https://picsum.photos/id/1025/480/320";
const JPEG_ALT2 = "https://picsum.photos/id/1039/480/320";
const PNG = "https://www.gstatic.com/webp/gallery3/1.png";
const WEBP = "https://www.gstatic.com/webp/gallery/1.webp";
const GIF =
  "https://upload.wikimedia.org/wikipedia/commons/d/d3/Newtons_cradle_animation_book_2.gif";
const ICON =
  "https://www.gstatic.com/images/icons/material/system/2x/favorite_black_24dp.png";
const BIG = "https://picsum.photos/id/1074/1600/1067"; // exercises downsampling
const TINY = "https://picsum.photos/id/1074/24/16"; // low-res stand-in placeholder

const SWAP_SOURCES = [JPEG, JPEG_ALT, JPEG_ALT2, WEBP, PNG];

const btn = {
  fontSize: "13px",
  color: "#0a7",
  padding: "8px 12px",
  marginRight: "8px",
  border: "1px solid #0a7",
  borderRadius: "6px",
} as const;

export function Exercise() {
  const [swapIndex, setSwapIndex] = useState(0);
  const [rapid, setRapid] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const stepSwap = useCallback(() => {
    setSwapIndex((i) => (i + 1) % SWAP_SOURCES.length);
  }, []);

  const rapidSwap = useCallback(() => {
    if (rapid) return;
    setRapid(true);
    let n = 0;
    const tick = () => {
      n += 1;
      setSwapIndex((i) => (i + 1) % SWAP_SOURCES.length);
      if (n < 24) {
        setTimeout(tick, 40);
      } else {
        setRapid(false);
      }
    };
    tick();
  }, [rapid]);

  return (
    <scroll-view
      scroll-orientation="vertical"
      style={{ width: "100%", height: "100%" }}
    >
      <view
        style={{ display: "flex", flexDirection: "column", padding: "16px" }}
      >
        <text
          style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "12px" }}
        >
          lynx-fast-image · exercise
        </text>

        <Case title="JPEG · contentFit cover">
          <FastImage style={BOX} source={JPEG} contentFit="cover" />
        </Case>

        <Case title="PNG · contentFit contain">
          <FastImage
            style={{ ...BOX, backgroundColor: "#eee" }}
            source={PNG}
            contentFit="contain"
          />
        </Case>

        <Case title="WebP">
          <FastImage style={BOX} source={WEBP} contentFit="cover" />
        </Case>

        <Case title="Animated GIF · autoplay" note="frames should advance">
          <FastImage style={BOX} source={GIF} contentFit="contain" autoplay />
        </Case>

        <Case
          title="placeholder → final"
          note="24×16 stand-in shows first, then the 1600px image"
        >
          <FastImage
            style={BOX}
            source={BIG}
            placeholder={TINY}
            placeholderContentFit="cover"
            contentFit="cover"
          />
        </Case>

        <Case title="transition · cross-dissolve 600ms">
          <FastImage
            key={`t-${reloadKey}`}
            style={BOX}
            source={`${JPEG_ALT}?t=${reloadKey}`}
            transition={600}
            contentFit="cover"
          />
        </Case>

        <Case title="blurRadius 10">
          <FastImage
            style={BOX}
            source={JPEG}
            blurRadius={10}
            contentFit="cover"
          />
        </Case>

        <Case title="tintColor · #E53935 on a template icon">
          <FastImage
            style={{ width: "64px", height: "64px" }}
            source={ICON}
            tintColor="#E53935"
            contentFit="contain"
          />
        </Case>

        <Case
          title="large source · downsampled to 240×160"
          note="peak memory should track the view size, not 1600×1067"
        >
          <FastImage
            style={BOX}
            source={BIG}
            contentFit="cover"
            allowDownscaling
          />
        </Case>

        <Case
          title="rapid source swap"
          note={`current #${swapIndex} — ${rapid ? "bursting…" : "idle"}; must not flash a stale image`}
        >
          <FastImage
            style={BOX}
            source={SWAP_SOURCES[swapIndex]}
            recyclingKey={`swap-${swapIndex}`}
            contentFit="cover"
          />
        </Case>

        <view
          style={{ display: "flex", flexDirection: "row", marginTop: "4px" }}
        >
          <text style={btn} bindtap={stepSwap}>
            step swap
          </text>
          <text style={btn} bindtap={rapidSwap}>
            rapid burst
          </text>
          <text style={btn} bindtap={() => setReloadKey((k) => k + 1)}>
            reload transition
          </text>
        </view>

        {/* TODO(bundled asset): add a real image to the mini-app's `static/`
            (or a rspeedy asset import) and point a <FastImage> at the
            release-relative path once the bundled-resource scheme + cache key
            are defined (PLAN §3.7). */}
      </view>
    </scroll-view>
  );
}
