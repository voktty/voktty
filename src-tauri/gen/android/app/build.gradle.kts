import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Load signing credentials from local.properties (not tracked by git)
val localProperties = Properties().apply {
    val propFiles = listOf(
        file("../local.properties"),
        file("../../local.properties"),
        file("../../../local.properties"),
        file("../../../../local.properties"),
        rootProject.file("local.properties"),
        rootProject.file("../../local.properties")
    )
    for (propFile in propFiles) {
        if (propFile.exists()) {
            propFile.inputStream().use { load(it) }
        }
    }
}

fun getSigningProp(key: String, defaultVal: String = ""): String {
    return localProperties.getProperty(key)
        ?: System.getenv(key)
        ?: localProperties.getProperty(key.lowercase())
        ?: defaultVal
}

android {
    compileSdk = 36
    namespace = "app.voktty.voktty"

    val customKeystorePath = getSigningProp("VOKTTY_KEYSTORE_PATH")
    val keystoreCandidate = if (customKeystorePath.isNotEmpty()) {
        val direct = file(customKeystorePath)
        if (direct.exists()) direct else file("../../../$customKeystorePath")
    } else {
        listOf(
            file("forgenex.website.jks"),
            file("newkeystore.keystore"),
            file("voktty-release.keystore"),
            file("release.keystore"),
            file("release.jks"),
            file("key.jks"),
            file("../../../forgenex.website.jks"),
            file("../../../newkeystore.keystore"),
            file("../../../voktty-release.keystore"),
            file("../../../release.jks"),
            file("../../../release.keystore")
        ).firstOrNull { it.exists() }
    }

    signingConfigs {
        if (keystoreCandidate != null && keystoreCandidate.exists()) {
            create("release") {
                storeFile = keystoreCandidate
                storePassword = getSigningProp("VOKTTY_STORE_PASSWORD", getSigningProp("storePassword"))
                keyAlias = getSigningProp("VOKTTY_KEY_ALIAS", getSigningProp("keyAlias", "voktty"))
                keyPassword = getSigningProp("VOKTTY_KEY_PASSWORD", getSigningProp("keyPassword"))
            }
        }
    }

    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "app.voktty.voktty"
        minSdk = 24
        // targetSdk 28 bypasses Android 10+ W^X (Write XOR Execute) SELinux
        // policy, which blocks exec() from app data directories. This is the
        // same approach Termux uses to allow running binaries from $PREFIX/bin/.
        targetSdk = 28
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (keystoreCandidate != null && keystoreCandidate.exists()) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                signingConfig = signingConfigs.getByName("debug")
            }
            isMinifyEnabled = false
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")