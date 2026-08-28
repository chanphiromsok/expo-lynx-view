import { NativeModule, requireNativeModule } from 'expo';

declare class ExpoLynxModule extends NativeModule {}

export default requireNativeModule<ExpoLynxModule>('ExpoLynx');
