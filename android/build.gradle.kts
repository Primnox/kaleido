buildscript {
    dependencies {
        // AGP 9 compiles Kotlin itself but takes the compiler from the Kotlin Gradle plugin.
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${libs.versions.kotlin.get()}")
    }
}

plugins {
    alias(libs.plugins.android.application) apply false
}
