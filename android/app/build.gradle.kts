plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.deepseekpp.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.deepseekpp.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.6.5"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("androidx.webkit:webkit:1.16.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
