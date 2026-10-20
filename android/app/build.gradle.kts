import com.android.build.api.dsl.ApplicationExtension
import javax.inject.Inject

plugins {
    alias(libs.plugins.android.application)
}

// One version for every platform: the desktop app's package.json.
val appVersion: String = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(rootProject.file("../package.json").readText())!!.groupValues[1]
val appVersionCode = appVersion.split('.').map { it.filter(Char::isDigit).toIntOrNull() ?: 0 }
    .let { (it.getOrElse(0) { 0 } * 10000) + (it.getOrElse(1) { 0 } * 100) + it.getOrElse(2) { 0 } }

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

configure<ApplicationExtension> {
    namespace = "app.kaleido.player"
    compileSdk {
        version = release(37) {
            minorApiLevel = 0
        }
    }

    defaultConfig {
        applicationId = "app.kaleido.player"
        minSdk {
            version = release(26)
        }
        targetSdk {
            version = release(36)
        }
        versionCode = appVersionCode
        versionName = appVersion
        buildConfigField("String", "LIBVLC_VERSION", "\"${libs.versions.libvlc.get()}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // CI signs releases with the key in KALEIDO_KEYSTORE; local builds fall back to the debug key.
    val keystore = System.getenv("KALEIDO_KEYSTORE")?.takeIf { it.isNotBlank() && file(it).exists() }
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("KALEIDO_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KALEIDO_KEY_ALIAS")
                keyPassword = System.getenv("KALEIDO_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    // libVLC is most of the size, so each phone type gets its own APK.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = false
        }
    }

    packaging {
        jniLibs {
            // Compressed native libraries make the download much smaller.
            useLegacyPackaging = true
        }
    }
}

dependencies {
    implementation(libs.libvlc)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
}

// The UI is the desktop app's own src/ folder (and the logo), copied in at build time so the
// two never drift apart.
abstract class CopyWebTask : DefaultTask() {
    @get:InputDirectory
    abstract val ui: DirectoryProperty

    @get:InputDirectory
    abstract val art: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val fs: FileSystemOperations

    @TaskAction
    fun run() {
        fs.sync {
            into(outputDir)
            from(ui) { into("src") }
            from(art) {
                into("assets")
                include("logo.svg", "icon-64.png", "icon-256.png")
            }
        }
    }
}

androidComponents {
    onVariants { variant ->
        val copy = tasks.register<CopyWebTask>("copy${variant.name.replaceFirstChar(Char::uppercase)}Web") {
            ui.set(rootProject.layout.projectDirectory.dir("../src"))
            art.set(rootProject.layout.projectDirectory.dir("../assets"))
        }
        variant.sources.assets?.addGeneratedSourceDirectory(copy, CopyWebTask::outputDir)
    }
}
