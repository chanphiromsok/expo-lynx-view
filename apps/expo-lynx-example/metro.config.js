// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const exampleRoot = __dirname;
const moduleRoot = path.resolve(__dirname, '..', '..', 'packages', 'expo-lynx');

config.watchFolders = [moduleRoot];

// The module source lives one directory above the example. Resolve runtime
// singletons from the example so Metro never bundles the module's development
// copies of React, React Native, or Expo alongside the native app versions.
const runtimeSingletons = new Set(['expo', 'react', 'react-native']);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const packageName = moduleName.startsWith('@')
    ? moduleName.split('/').slice(0, 2).join('/')
    : moduleName.split('/')[0];

  if (runtimeSingletons.has(packageName)) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(exampleRoot, 'index.ts') },
      moduleName,
      platform
    );
  }

  if (moduleName === 'expo-lynx-view') {
    return {
      filePath: path.join(moduleRoot, 'src', 'index.ts'),
      type: 'sourceFile',
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;
