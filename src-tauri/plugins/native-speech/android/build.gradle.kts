plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.imehc.speech"
    compileSdk = 36
    defaultConfig { minSdk = 28 }
    kotlinOptions { jvmTarget = "1.8" }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}
dependencies {
    implementation("androidx.appcompat:appcompat:1.6.0")
    implementation(project(":tauri-android"))
    testImplementation("junit:junit:4.13.2")
}
