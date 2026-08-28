import { NativeModule, registerWebModule } from 'expo';

class ExpoLynxModule extends NativeModule {}

export default registerWebModule(ExpoLynxModule, 'ExpoLynx');
