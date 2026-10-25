plugins {
    id("com.android.application")
}

android {
    namespace = "ie.home.gosports"
    compileSdk = 37

    defaultConfig {
        applicationId = "ie.home.gosports"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "1.2"
    }
}

dependencies {
    // Unit tests run on the PC's JVM, where Android's org.json is only a stub.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
