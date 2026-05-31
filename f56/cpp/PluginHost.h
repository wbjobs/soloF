#pragma once

#include <JuceHeader.h>
#include <vector>
#include <string>
#include <atomic>
#include <memory>

struct ParameterInfo {
    int index;
    std::string name;
    float value;
    float minValue;
    float maxValue;
    float defaultValue;
};

class PluginHost : public juce::AudioIODeviceCallback {
public:
    PluginHost();
    ~PluginHost() override;

    bool initializeAudioDevice();
    void shutdownAudioDevice();

    bool loadPlugin(const std::string& pluginPath);
    void unloadPlugin();
    bool isPluginLoaded() const;

    std::string getPluginName() const;
    std::vector<ParameterInfo> getParameters() const;
    void setParameterValue(int index, float value);
    float getParameterValue(int index) const;
    void adjustParameterValue(int index, float delta);

    void audioDeviceIOCallbackWithContext(
        const float** inputChannelData,
        int numInputChannels,
        float** outputChannelData,
        int numOutputChannels,
        int numSamples,
        const juce::AudioIODeviceCallbackContext& context) override;

    void audioDeviceAboutToStart(juce::AudioIODevice* device) override;
    void audioDeviceStopped() override;

private:
    struct ParameterSmoother {
        std::atomic<float> target{0.0f};
        float current = 0.0f;
        float coefficient = 0.99f;

        void updateSampleRate(double sampleRate, float smoothTimeMs = 20.0f) {
            const float samples = static_cast<float>(sampleRate * smoothTimeMs / 1000.0f);
            coefficient = std::exp(-1.0f / samples);
        }

        float process() {
            const float t = target.load(std::memory_order_relaxed);
            current = coefficient * current + (1.0f - coefficient) * t;
            return current;
        }

        void setInstant(float value) {
            target.store(value, std::memory_order_relaxed);
            current = value;
        }
    };

    std::unique_ptr<juce::AudioDeviceManager> deviceManager;
    std::unique_ptr<juce::AudioPluginFormatManager> formatManager;
    std::unique_ptr<juce::AudioPluginInstance> pluginInstance;
    juce::AudioBuffer<float> processingBuffer;
    std::vector<ParameterSmoother> parameterSmoothers;
    std::vector<std::string> parameterNames;
    std::vector<float> parameterDefaults;
    std::atomic<bool> pluginLoaded{false};
    std::atomic<bool> audioRunning{false};
    std::atomic<int> activeNumChannels{2};
    double sampleRate = 44100.0;
    int bufferSize = 512;

    void applySmoothedParameters();
};
