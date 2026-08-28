import Constants from 'expo-constants';
import { ExpoLynxView } from 'expo-lynx';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  lynxDevBundleHost?: string;
  lynxDevBundlePort?: number;
  lynxProdBundleUrl?: string;
};

const devHost = extra.lynxDevBundleHost ?? '127.0.0.1';
const devPort = extra.lynxDevBundlePort ?? 3000;
const DEV_BUNDLE = `http://${devHost}:${devPort}/main.lynx.bundle`;
const STATIC_BUNDLE = 'static.lynx';
const PROD_BUNDLE = extra.lynxProdBundleUrl ?? DEV_BUNDLE;
console.log(PROD_BUNDLE);

type SourceKind = 'dev' | 'static' | 'prod';

const SOURCE_OPTIONS: readonly { kind: SourceKind; label: string }[] = [
  { kind: 'prod', label: 'Prod (HTTPS CDN)' },
  { kind: 'dev', label: 'Dev (HTTP LAN)' },
  { kind: 'static', label: 'Static (bundled)' },
];

export default function App() {
  const [sourceKind, setSourceKind] = useState<SourceKind>('dev');
  const [status, setStatus] = useState('Loading…');

  const source =
    sourceKind === 'prod' ? PROD_BUNDLE : sourceKind === 'dev' ? DEV_BUNDLE : STATIC_BUNDLE;

  const selectSource = (nextSource: SourceKind) => {
    setSourceKind(nextSource);
    setStatus(`Loading ${nextSource} bundle…`);
  };
  return (
    <ExpoLynxView
      url={STATIC_BUNDLE}
      initialData={{ greeting: `Hello from Expo (${sourceKind})` }}
      onLoad={() => setStatus(`Loaded ${sourceKind} bundle`)}
      onLoadStart={() => setStatus(`Loading ${sourceKind} bundle…`)}
      onError={({ nativeEvent }) => {
        setStatus(`Error loading ${sourceKind} bundle: ${nativeEvent.message}`);
        console.error('Lynx error', nativeEvent);
      }}
      style={styles.lynxView}
      testID="lynx-view"
    />
  );

  return (
    <SafeAreaProvider>
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
                  style={[styles.sourceButton, selected && styles.sourceButtonSelected]}
                  testID={`${kind}-bundle-button`}>
                  <Text
                    style={[styles.sourceButtonText, selected && styles.sourceButtonTextSelected]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text accessibilityLiveRegion="polite" style={styles.status} testID="lynx-status">
            {status}
          </Text>
          <ExpoLynxView
            url={source}
            initialData={{ greeting: `Hello from Expo (${sourceKind})` }}
            onLoad={() => setStatus(`Loaded ${sourceKind} bundle`)}
            onLoadStart={() => setStatus(`Loading ${sourceKind} bundle…`)}
            onError={({ nativeEvent }) => {
              setStatus(`Error loading ${sourceKind} bundle: ${nativeEvent.message}`);
              console.error('Lynx error', nativeEvent);
            }}
            style={styles.lynxView}
            testID="lynx-view"
          />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f4f5',
  },
  container: {
    flex: 1,
    gap: 12,
    padding: 16,
  },
  title: {
    color: '#18181b',
    fontSize: 24,
    fontWeight: '700',
  },
  sourcePicker: {
    flexDirection: 'row',
    gap: 8,
  },
  sourceButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#e4e4e7',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sourceButtonSelected: {
    backgroundColor: '#18181b',
  },
  sourceButtonText: {
    color: '#3f3f46',
    fontSize: 15,
    fontWeight: '600',
  },
  sourceButtonTextSelected: {
    color: '#fff',
  },
  status: {
    color: '#52525b',
    fontSize: 14,
  },
  lynxView: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: '#fff',
  },
});
