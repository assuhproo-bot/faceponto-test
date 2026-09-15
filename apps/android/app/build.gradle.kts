plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
    id("androidx.room")
}

android {
    namespace = "br.com.faceponto.terminal"
    compileSdk = 37

    val apiBaseUrl = providers.gradleProperty("facepontoApiUrl").orElse("http://127.0.0.1:3001").get()
    val applicationSuffix = providers.gradleProperty("facepontoApplicationIdSuffix").orElse("").get()

    defaultConfig {
        // The hosted-test APK can use a suffix, preserving the local-test terminal and its data.
        applicationId = "br.com.faceponto.terminal$applicationSuffix"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        // The local test terminal is arm64. Avoid bundling emulator and 32-bit native libraries.
        ndk { abiFilters += "arm64-v8a" }
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.08.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.camera:camera-core:1.6.2")
    implementation("androidx.camera:camera-camera2:1.6.2")
    implementation("androidx.camera:camera-lifecycle:1.6.2")
    implementation("androidx.camera:camera-view:1.6.2")
    implementation("androidx.room:room-runtime:2.8.5")
    implementation("androidx.room:room-ktx:2.8.5")
    ksp("androidx.room:room-compiler:2.8.5")
    implementation("androidx.work:work-runtime:2.11.2")
    implementation("androidx.datastore:datastore-preferences:1.2.1")
    implementation("org.opencv:opencv:4.14.0")
    // Used only by the debug-only experimental MiniFASNet PAD implementation.
    debugImplementation("com.microsoft.onnxruntime:onnxruntime-android:1.29.0")
    testImplementation("junit:junit:4.13.2")
}

room { schemaDirectory("$projectDir/schemas") }
