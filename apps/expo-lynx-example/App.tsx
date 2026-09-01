import Constants from "expo-constants";
import { ExpoLynxView, type LynxSource } from "expo-lynx-view";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  lynxDevBundleHost?: string;
  lynxDevBundlePort?: number;
};

const devHost = "192.168.18.144";
const devPort = extra.lynxDevBundlePort ?? 3000;
const DEV_BUNDLE = `http://${devHost}:${devPort}/main.lynx.bundle`;

type SourceKind = "managed" | "dev" | "embedded";

const SOURCE_OPTIONS: readonly { kind: SourceKind; label: string }[] = [
  { kind: "managed", label: "Managed cache" },
  { kind: "dev", label: "Direct dev" },
  { kind: "embedded", label: "Embedded" },
];

export default function App() {
  const [sourceKind, setSourceKind] = useState<SourceKind>("managed");
  const [status, setStatus] = useState("Loading…");
  const [isSplashVisible, setSplashVisible] = useState(true);

  const source: LynxSource =
    sourceKind === "managed"
      ? {
          kind: "managed",
          feature: "delivery",
        }
      : sourceKind === "dev"
        ? { kind: "development", url: DEV_BUNDLE }
        : { kind: "embedded", feature: "delivery" };

  const selectSource = (nextSource: SourceKind) => {
    setSourceKind(nextSource);
    setStatus(`Loading ${nextSource} bundle…`);
    setSplashVisible(true);
  };
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text style={styles.title}>Lynx embedded in Expo</Text>
          <View style={styles.sourcePicker}>
            {SOURCE_OPTIONS.map(({ kind, label }) => {
              const selected = sourceKind === kind;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={kind}
                  onPress={() => selectSource(kind)}
                  style={[
                    styles.sourceButton,
                    selected && styles.sourceButtonSelected,
                  ]}
                  testID={`${kind}-bundle-button`}
                >
                  <Text
                    style={[
                      styles.sourceButtonText,
                      selected && styles.sourceButtonTextSelected,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text
            accessibilityLiveRegion="polite"
            style={styles.status}
            testID="lynx-status"
          >
            {status}
          </Text>
          <View style={styles.lynxContainer}>
            <ExpoLynxView
              source={source}
              initialData={{ greeting: `Hello from Expo (${sourceKind})` }}
              onLoad={({ nativeEvent }) => {
                setStatus(
                  `Loaded ${nativeEvent.version} from ${nativeEvent.source} (${nativeEvent.durationMs} ms)`,
                );
                // Embedded content is a usable first-class fallback. A
                // next-open update may continue staging afterward, but it must
                // never keep this blocking splash over an interactive mini app.
                setSplashVisible(false);
              }}
              onLoadStart={({ nativeEvent }) => {
                setSplashVisible(true);
                setStatus(`Loading ${nativeEvent.source} bundle…`);
              }}
              onError={({ nativeEvent }) => {
                // The native view has already retained or restored its verified
                // cache/embedded fallback, so reveal that fallback on failure.
                setSplashVisible(false);
                setStatus(`${nativeEvent.stage} error: ${nativeEvent.message}`);
                console.error("Lynx error", nativeEvent);
              }}
              onUpdate={({ nativeEvent }) => {
                switch (nativeEvent.phase) {
                  case "checking":
                    setStatus("Checking for a mini-app update…");
                    break;
                  case "no-update":
                    setStatus("Mini app is up to date");
                    break;
                  case "downloaded":
                    setStatus("Mini-app update downloaded");
                    break;
                  case "staged":
                    setStatus(
                      nativeEvent.version
                        ? `Version ${nativeEvent.version} is ready for the next open`
                        : "Mini-app update is ready for the next open",
                    );
                    break;
                  case "error":
                    setStatus(
                      nativeEvent.message
                        ? `Update failed: ${nativeEvent.message}`
                        : "Update check failed; current mini app remains available",
                    );
                    break;
                }
              }}
              style={styles.lynxView}
              testID="lynx-view"
            />
            {isSplashVisible ? (
              <View
                accessibilityLiveRegion="polite"
                accessibilityViewIsModal
                style={styles.splashOverlay}
                testID="lynx-splash"
              >
                <ActivityIndicator color="#18181b" size="large" />
                <Text style={styles.splashTitle}>Loading mini app…</Text>
                <Text style={styles.splashMessage}>{status}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f4f4f5",
  },
  container: {
    flex: 1,
    gap: 12,
    padding: 16,
  },
  title: {
    color: "#18181b",
    fontSize: 24,
    fontWeight: "700",
  },
  sourcePicker: {
    flexDirection: "row",
    gap: 8,
  },
  sourceButton: {
    flex: 1,
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "#e4e4e7",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sourceButtonSelected: {
    backgroundColor: "#18181b",
  },
  sourceButtonText: {
    color: "#3f3f46",
    fontSize: 15,
    fontWeight: "600",
  },
  sourceButtonTextSelected: {
    color: "#fff",
  },
  status: {
    color: "#52525b",
    fontSize: 14,
  },
  lynxContainer: {
    flex: 1,
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "#fff",
  },
  lynxView: {
    flex: 1,
    backgroundColor: "#fff",
  },
  splashOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
    backgroundColor: "#fff",
  },
  splashTitle: {
    color: "#18181b",
    fontSize: 20,
    fontWeight: "700",
  },
  splashMessage: {
    color: "#71717a",
    fontSize: 14,
    textAlign: "center",
  },
});
