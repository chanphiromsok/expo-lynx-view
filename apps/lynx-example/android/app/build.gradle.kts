plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.kapt")
}

android {
  namespace = "com.lynxexample"
  compileSdk = 36

  defaultConfig {
    applicationId = "com.lynxexample"
    minSdk = 24
    targetSdk = 36
    versionCode = 1
    versionName = "1.0"
  }

  buildTypes {
    debug {
      isDebuggable = true
    }
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions {
    jvmTarget = "17"
  }
  buildFeatures {
    buildConfig = true
  }

  // Compile the <x-lynx-fast-image> element (Glide) straight from expo-lynx-view.
  // The sources are Expo-free (Lynx + Glide + org.json only), so a bare host can
  // build them directly — no separate package, no duplication.
  sourceSets["main"].java.srcDir(
    "../../../../packages/expo-lynx/android/src/main/java/expo/modules/lynx/fastimage"
  )

  packaging {
    resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
  }
}

dependencies {
  implementation("androidx.appcompat:appcompat:1.7.1")
  implementation("androidx.core:core-ktx:1.13.1")

  // Lynx 4.0.0 — core + JS + services. No lynx-service-image, no Fresco:
  // <x-lynx-fast-image> renders through Glide instead.
  implementation("org.lynxsdk.lynx:lynx:4.0.0")
  implementation("org.lynxsdk.lynx:lynx-jssdk:4.0.0")
  implementation("org.lynxsdk.lynx:lynx-trace:4.0.0")
  implementation("org.lynxsdk.lynx:primjs:4.0.0")
  implementation("org.lynxsdk.lynx:lynx-service-log:4.0.0")
  implementation("org.lynxsdk.lynx:lynx-service-http:4.0.0")
  implementation("org.lynxsdk.lynx:xelement:4.0.0")
  implementation("org.lynxsdk.lynx:xelement-input:4.0.0")
  implementation("com.squareup.okhttp3:okhttp:4.9.0")

  // DevTool + rspeedy Fast Refresh (debug only).
  debugImplementation("org.lynxsdk.lynx:lynx-devtool:4.0.0")
  debugImplementation("org.lynxsdk.lynx:lynx-service-devtool:4.0.0")

  // <x-lynx-fast-image> backing loader — same version Expo Image 57.x uses.
  implementation("com.github.bumptech.glide:glide:5.0.5")

  // Generates the @LynxProp PropsSetter for LynxFastImageUI. Without the
  // processor the prop setters are never invoked at runtime.
  kapt("org.lynxsdk.lynx:lynx-processor:4.0.0")
  compileOnly("org.lynxsdk.lynx:lynx-processor:4.0.0")
  annotationProcessor("org.lynxsdk.lynx:lynx-processor:4.0.0")
}
