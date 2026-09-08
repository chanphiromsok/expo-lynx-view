import { root } from "@lynx-js/react";

import { App } from "./App";
import { Exercise } from "./Exercise";
import { EventProbe } from "./EventProbe";
import { ListDemo } from "./ListDemo";

// Flip this to drive each Phase 3 verification screen from the simulator.
//   'app'      — single remote image (smoke test)
//   'events'   — loadstart / progress / load / display / error payloads
//   'exercise' — format / placeholder / transition / blur / tint / downsample
//                / rapid swap / bundled asset / data: URL
//   'list'     — <list> cell-recycle stress test
const ENTRY = "app" as "app" | "events" | "exercise" | "list";

const SCREENS = {
  app: App,
  events: EventProbe,
  exercise: Exercise,
  list: ListDemo,
} as const;

const Screen = SCREENS[ENTRY];
root.render(<Screen />);
