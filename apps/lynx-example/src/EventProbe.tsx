import { useState } from "@lynx-js/react";
import {
  FastImage,
  type FastImageErrorEvent,
  type FastImageLoadEvent,
  type FastImageProgressEvent,
} from "lynx-fast-image";

/**
 * Verifies every `<FastImage>` event fires with the Expo-Image-shaped payload.
 * Each handler writes its `event.detail` to on-screen text.
 * Point `src/index.tsx` at `<EventProbe />` to run it.
 */

const BOX = { width: "200px", height: "130px", marginTop: "6px" } as const;
const line = { fontSize: "12px", color: "#333", marginTop: "2px" } as const;

const GOOD = "https://picsum.photos/id/1005/400/260";
const BIG = "https://picsum.photos/id/1005/2400/1560"; // slow -> progress
const BAD_HOST = "https://no-such-host.invalid/x.jpg"; // -> error
const BAD_404 = "https://picsum.photos/id/999999999/1/1"; // HTTP error -> error

export function EventProbe() {
  const [log, setLog] = useState<Record<string, string>>({});
  const put = (k: string, v: unknown) =>
    setLog((m) => ({ ...m, [k]: JSON.stringify(v) }));

  return (
    <view
      style={{ display: "flex", flexDirection: "column", padding: "16px", height: "100%" }}
    >
      <text style={{ fontSize: "15px", fontWeight: "bold" }}>event probe</text>

      <text style={{ fontSize: "13px", fontWeight: "bold", marginTop: "12px" }}>
        1 · success → loadstart / load / display
      </text>
      <FastImage
        style={BOX}
        source={GOOD}
        contentFit="cover"
        onLoadStart={() => put("1.loadstart", true)}
        onLoad={(e: FastImageLoadEvent) => put("1.load", e.detail)}
        onDisplay={() => put("1.display", true)}
        onError={(e: FastImageErrorEvent) => put("1.error", e.detail)}
      />
      <text style={line}>loadstart: {log["1.loadstart"] ?? "—"}</text>
      <text style={line}>load: {log["1.load"] ?? "—"}</text>
      <text style={line}>display: {log["1.display"] ?? "—"}</text>

      <text style={{ fontSize: "13px", fontWeight: "bold", marginTop: "12px" }}>
        2 · large → progress
      </text>
      <FastImage
        style={BOX}
        source={BIG}
        contentFit="cover"
        cachePolicy="none"
        onProgress={(e: FastImageProgressEvent) => put("2.progress", e.detail)}
        onLoad={() => put("2.load", "done")}
      />
      <text style={line}>progress: {log["2.progress"] ?? "—"}</text>
      <text style={line}>load: {log["2.load"] ?? "—"}</text>

      <text style={{ fontSize: "13px", fontWeight: "bold", marginTop: "12px" }}>
        3 · bad host → error
      </text>
      <FastImage
        style={BOX}
        source={BAD_HOST}
        onError={(e: FastImageErrorEvent) => put("3.error", e.detail)}
        onLoad={() => put("3.load", "UNEXPECTED")}
      />
      <text style={line}>error: {log["3.error"] ?? "—"}</text>

      <text style={{ fontSize: "13px", fontWeight: "bold", marginTop: "12px" }}>
        4 · HTTP 404 → error
      </text>
      <FastImage
        style={BOX}
        source={BAD_404}
        onError={(e: FastImageErrorEvent) => put("4.error", e.detail)}
        onLoad={() => put("4.load", "UNEXPECTED")}
      />
      <text style={line}>error: {log["4.error"] ?? "—"}</text>
    </view>
  );
}
