extern crate cc;
extern crate cmake;

use std::path::PathBuf;

fn main() {
    let dst = cmake::Config::new("cpp")
        .define("JUCE_DIR", env!("JUCE_DIR"))
        .build();

    println!("cargo:rustc-link-search=native={}/build", dst.display());
    println!("cargo:rustc-link-lib=static=vst3_host_core");
    
    let juce_libs = PathBuf::from(env!("JUCE_DIR")).join("build/lib");
    println!("cargo:rustc-link-search=native={}", juce_libs.display());
    
    println!("cargo:rustc-link-lib=static=juce_audio_basics");
    println!("cargo:rustc-link-lib=static=juce_audio_devices");
    println!("cargo:rustc-link-lib=static=juce_audio_formats");
    println!("cargo:rustc-link-lib=static=juce_audio_processors");
    println!("cargo:rustc-link-lib=static=juce_core");
    println!("cargo:rustc-link-lib=static=juce_data_structures");
    println!("cargo:rustc-link-lib=static=juce_events");
    println!("cargo:rustc-link-lib=static=juce_graphics");
    println!("cargo:rustc-link-lib=static=juce_gui_basics");
    println!("cargo:rustc-link-lib=static=juce_gui_extra");

    #[cfg(target_os = "linux")]
    {
        println!("cargo:rustc-link-lib=dylib=asound");
        println!("cargo:rustc-link-lib=dylib=pthread");
        println!("cargo:rustc-link-lib=dylib=dl");
        println!("cargo:rustc-link-lib=dylib=rt");
    }

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=AudioToolbox");
        println!("cargo:rustc-link-lib=framework=Accelerate");
        println!("cargo:rustc-link-lib=framework=QuartzCore");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=dylib=c++");
    }

    #[cfg(target_os = "windows")]
    {
        println!("cargo:rustc-link-lib=dylib=ole32");
        println!("cargo:rustc-link-lib=dylib=user32");
        println!("cargo:rustc-link-lib=dylib=gdi32");
        println!("cargo:rustc-link-lib=dylib=shell32");
        println!("cargo:rustc-link-lib=dylib=winmm");
        println!("cargo:rustc-link-lib=dylib=ws2_32");
        println!("cargo:rustc-link-lib=dylib=shlwapi");
    }

    println!("cargo:rerun-if-changed=cpp/PluginHost.h");
    println!("cargo:rerun-if-changed=cpp/PluginHost.cpp");
    println!("cargo:rerun-if-changed=cpp/ffi_bridge.h");
    println!("cargo:rerun-if-changed=cpp/ffi_bridge.cpp");
    println!("cargo:rerun-if-changed=cpp/CMakeLists.txt");
}
