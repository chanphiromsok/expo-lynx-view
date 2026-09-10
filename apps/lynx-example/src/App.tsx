import { FastImage } from "lynx-fast-image";

import dot from "./assets/dot.png";
import photo from "./assets/photo.png";

// What does an rspeedy static-asset import actually resolve to on Lynx?
//   - small file  -> inlined `data:image/png;base64,...`
//   - large file  -> `${assetPrefix}/static/.../photo.<hash>.png` (an http URL
//                     in dev — the dev server serves it)
// Either way it reaches <FastImage> as a plain string `source`, so it goes
// through the normal SDWebImage path, NOT the bundled-resource branch.
console.log("[asset] dot   =", dot);
console.log("[asset] photo =", photo);

const box = {
  width: "220px",
  height: "150px",
  marginTop: "10px",
  borderRadius: "12px",
} as const;
const label = { fontSize: "12px", color: "#555", marginTop: "16px" } as const;

export function App() {
  return (
    <view style={{ display: "flex", flexDirection: "column", padding: "16px" }}>
      <text style={{ fontSize: "15px", fontWeight: "bold" }}>
        lynx-fast-image · static assets
      </text>

      <text style={label}>1 · remote (baseline)</text>
      <FastImage
        style={{
          width: "220px",
          height: "150px",
          marginTop: "10px",
          borderRadius: "12px",
        }}
        source="https://picsum.photos/440/300"
        contentFit="cover"
        onLoad={(e) => console.log("remote load", e.detail)}
        onError={(e) => console.log("remote error", e.detail)}
      />

      <text style={label}>
        2 · rspeedy static import — large (emitted file URL)
      </text>
      <FastImage
        style={box}
        source={photo}
        contentFit="cover"
        onLoad={(e) => console.log("photo load", e.detail)}
        onError={(e) => console.log("photo error", e.detail)}
      />

      <text style={label}>
        3 · rspeedy static import — tiny (inlined data: URI)
      </text>
      <FastImage
        style={box}
        source={dot}
        contentFit="cover"
        onLoad={(e) => console.log("dot load", e.detail)}
        onError={(e) => console.log("dot error", e.detail)}
      />
    </view>
  );
}
