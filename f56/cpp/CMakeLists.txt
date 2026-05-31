cmake_minimum_required(VERSION 3.15)
project(vst3_host_core CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(NOT DEFINED JUCE_DIR)
    message(FATAL_ERROR "JUCE_DIR must be defined. Use -DJUCE_DIR=/path/to/JUCE")
endif()

add_subdirectory(${JUCE_DIR} ${CMAKE_BINARY_DIR}/juce)

add_library(vst3_host_core STATIC
    PluginHost.cpp
    ffi_bridge.cpp
)

target_include_directories(vst3_host_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${JUCE_DIR}/modules
)

target_link_libraries(vst3_host_core PUBLIC
    juce::juce_audio_basics
    juce::juce_audio_devices
    juce::juce_audio_formats
    juce::juce_audio_processors
    juce::juce_core
    juce::juce_data_structures
    juce::juce_events
    juce::juce_graphics
    juce::juce_gui_basics
    juce::juce_gui_extra
)

juce_generate_juce_header(vst3_host_core)

target_compile_definitions(vst3_host_core PUBLIC
    JUCE_STANDALONE_APPLICATION=1
    JUCE_PLUGINHOST_VST3=1
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
)

if(UNIX AND NOT APPLE)
    target_link_libraries(vst3_host_core PUBLIC pthread dl rt)
endif()

if(APPLE)
    target_link_libraries(vst3_host_core PUBLIC "-framework CoreAudio -framework AudioToolbox -framework Accelerate -framework QuartzCore -framework AppKit -framework Foundation")
endif()

if(WIN32)
    target_link_libraries(vst3_host_core PUBLIC ole32 user32 gdi32 shell32 winmm ws2_32 shlwapi)
endif()
