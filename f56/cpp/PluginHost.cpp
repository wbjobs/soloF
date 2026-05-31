#include "PluginHost.h"
#include <algorithm>
#include <cmath>

PluginHost::PluginHost() {
    formatManager = std::make_unique<juce::AudioPluginFormatManager>();
    formatManager->addDefaultFormats();
    deviceManager = std::make_unique<juce::AudioDeviceManager>();
    processingBuffer.setSize(8, 8192, false, false, true);
}

PluginHost::~PluginHost() {
    shutdownAudioDevice();
    unloadPlugin();
}

bool PluginHost::initializeAudioDevice() {
    auto setup = deviceManager->getAudioDeviceSetup();
    setup.sampleRate = sampleRate;
    setup.bufferSize = bufferSize;

    auto error = deviceManager->initialise(
        2,
        2,
        nullptr,
        true,
        {},
        &setup
    );

    if (error.isNotEmpty()) {
        return false;
    }

    deviceManager->addAudioCallback(this);
    return true;
}

void PluginHost::shutdownAudioDevice() {
    audioRunning.store(false, std::memory_order_release);
    deviceManager->removeAudioCallback(this);
    deviceManager->closeAudioDevice();
}

bool PluginHost::loadPlugin(const std::string& pluginPath) {
    unloadPlugin();

    juce::File pluginFile(juce::CharPointer_UTF8(pluginPath.c_str()));
    if (!pluginFile.existsAsFile()) {
        return false;
    }

    juce::String errorMessage;
    auto description = std::make_unique<juce::PluginDescription>();
    description->fileOrIdentifier = pluginFile.getFullPathName();

    pluginInstance = formatManager->createPluginInstance(
        *description,
        sampleRate,
        bufferSize,
        errorMessage
    );

    if (!pluginInstance) {
        return false;
    }

    auto& params = pluginInstance->getParameters();
    parameterSmoothers.clear();
    parameterNames.clear();
    parameterDefaults.clear();
    parameterSmoothers.resize(params.size());
    parameterNames.resize(params.size());
    parameterDefaults.resize(params.size());

    for (int i = 0; i < params.size(); ++i) {
        auto* param = params[i];
        parameterNames[i] = param->getName(256).toStdString();
        parameterDefaults[i] = param->getDefaultValue();
        parameterSmoothers[i].updateSampleRate(sampleRate, 30.0f);
        parameterSmoothers[i].setInstant(param->getDefaultValue());
        param->setValue(param->getDefaultValue());
    }

    pluginInstance->prepareToPlay(sampleRate, bufferSize);
    pluginLoaded.store(true, std::memory_order_release);
    return true;
}

void PluginHost::unloadPlugin() {
    const bool wasLoaded = pluginLoaded.exchange(false, std::memory_order_acq_rel);
    if (wasLoaded && pluginInstance) {
        pluginInstance->releaseResources();
        pluginInstance.reset();
    }
    parameterSmoothers.clear();
    parameterNames.clear();
    parameterDefaults.clear();
}

bool PluginHost::isPluginLoaded() const {
    return pluginLoaded.load(std::memory_order_acquire);
}

std::string PluginHost::getPluginName() const {
    if (!pluginInstance) {
        return "";
    }
    return pluginInstance->getName().toStdString();
}

std::vector<ParameterInfo> PluginHost::getParameters() const {
    std::vector<ParameterInfo> params;
    if (!pluginInstance) {
        return params;
    }

    auto& parameters = pluginInstance->getParameters();
    for (int i = 0; i < parameters.size(); ++i) {
        auto* param = parameters[i];
        ParameterInfo info;
        info.index = i;
        info.name = parameterNames[i];
        info.value = parameterSmoothers[i].target.load(std::memory_order_relaxed);
        info.minValue = param->getNormalisableRange().start;
        info.maxValue = param->getNormalisableRange().end;
        info.defaultValue = parameterDefaults[i];
        params.push_back(info);
    }
    return params;
}

void PluginHost::setParameterValue(int index, float value) {
    if (index < 0 || index >= static_cast<int>(parameterSmoothers.size())) {
        return;
    }
    const float clamped = std::clamp(value, 0.0f, 1.0f);
    parameterSmoothers[index].target.store(clamped, std::memory_order_relaxed);
}

void PluginHost::adjustParameterValue(int index, float delta) {
    if (index < 0 || index >= static_cast<int>(parameterSmoothers.size())) {
        return;
    }
    float current = parameterSmoothers[index].target.load(std::memory_order_relaxed);
    float new_value = std::clamp(current + delta, 0.0f, 1.0f);
    parameterSmoothers[index].target.store(new_value, std::memory_order_relaxed);
}

float PluginHost::getParameterValue(int index) const {
    if (index < 0 || index >= static_cast<int>(parameterSmoothers.size())) {
        return 0.0f;
    }
    return parameterSmoothers[index].target.load(std::memory_order_relaxed);
}

void PluginHost::applySmoothedParameters() {
    if (!pluginLoaded.load(std::memory_order_acquire) || !pluginInstance) {
        return;
    }

    auto& params = pluginInstance->getParameters();
    const int numParams = std::min(static_cast<int>(parameterSmoothers.size()), params.size());

    for (int i = 0; i < numParams; ++i) {
        const float smoothedValue = parameterSmoothers[i].process();
        params[i]->setValueNotifyingHost(smoothedValue);
    }
}

void PluginHost::audioDeviceIOCallbackWithContext(
    const float** inputChannelData,
    int numInputChannels,
    float** outputChannelData,
    int numOutputChannels,
    int numSamples,
    const juce::AudioIODeviceCallbackContext& context) {

    juce::ignoreUnused(context);

    const int maxChannels = std::max(numInputChannels, numOutputChannels);
    const int bufChannels = processingBuffer.getNumChannels();
    const int bufSamples = processingBuffer.getNumSamples();

    if (maxChannels > bufChannels || numSamples > bufSamples) {
        for (int ch = 0; ch < numOutputChannels; ++ch) {
            if (outputChannelData[ch] != nullptr) {
                juce::FloatVectorOperations::clear(outputChannelData[ch], numSamples);
            }
        }
        return;
    }

    for (int ch = 0; ch < numInputChannels && ch < maxChannels; ++ch) {
        if (inputChannelData[ch] != nullptr) {
            processingBuffer.copyFrom(ch, 0, inputChannelData[ch], numSamples);
        } else {
            processingBuffer.clear(ch, 0, numSamples);
        }
    }

    for (int ch = numInputChannels; ch < maxChannels; ++ch) {
        processingBuffer.clear(ch, 0, numSamples);
    }

    if (pluginLoaded.load(std::memory_order_acquire) && pluginInstance) {
        applySmoothedParameters();
        juce::MidiBuffer midiBuffer;
        pluginInstance->processBlock(processingBuffer, midiBuffer);
    }

    for (int ch = 0; ch < numOutputChannels; ++ch) {
        if (outputChannelData[ch] != nullptr) {
            if (ch < maxChannels) {
                juce::FloatVectorOperations::copy(
                    outputChannelData[ch],
                    processingBuffer.getReadPointer(ch),
                    numSamples
                );
            } else {
                juce::FloatVectorOperations::clear(outputChannelData[ch], numSamples);
            }
        }
    }
}

void PluginHost::audioDeviceAboutToStart(juce::AudioIODevice* device) {
    sampleRate = device->getCurrentSampleRate();
    bufferSize = device->getCurrentBufferSizeSamples();

    processingBuffer.setSize(8, std::max(bufferSize * 2, 4096), false, false, true);

    for (auto& smoother : parameterSmoothers) {
        smoother.updateSampleRate(sampleRate, 30.0f);
    }

    if (pluginInstance) {
        pluginInstance->prepareToPlay(sampleRate, bufferSize);
    }

    audioRunning.store(true, std::memory_order_release);
}

void PluginHost::audioDeviceStopped() {
    audioRunning.store(false, std::memory_order_release);
    if (pluginInstance) {
        pluginInstance->releaseResources();
    }
}
