#include "ffi_bridge.h"
#include "PluginHost.h"
#include <cstring>
#include <vector>

static std::vector<char*> allocatedStrings;
static std::vector<FFIParameter*> allocatedParameters;

extern "C" {

void* host_create() {
    return new PluginHost();
}

void host_destroy(void* host) {
    if (host) {
        delete static_cast<PluginHost*>(host);
    }
}

int host_initialize_audio(void* host) {
    if (!host) return 0;
    return static_cast<PluginHost*>(host)->initializeAudioDevice() ? 1 : 0;
}

void host_shutdown_audio(void* host) {
    if (host) {
        static_cast<PluginHost*>(host)->shutdownAudioDevice();
    }
}

int host_load_plugin(void* host, const char* plugin_path) {
    if (!host || !plugin_path) return 0;
    return static_cast<PluginHost*>(host)->loadPlugin(plugin_path) ? 1 : 0;
}

void host_unload_plugin(void* host) {
    if (host) {
        static_cast<PluginHost*>(host)->unloadPlugin();
    }
}

int host_is_plugin_loaded(void* host) {
    if (!host) return 0;
    return static_cast<PluginHost*>(host)->isPluginLoaded() ? 1 : 0;
}

const char* host_get_plugin_name(void* host) {
    if (!host) return nullptr;
    std::string name = static_cast<PluginHost*>(host)->getPluginName();
    char* cstr = new char[name.length() + 1];
    std::strcpy(cstr, name.c_str());
    allocatedStrings.push_back(cstr);
    return cstr;
}

FFIParameterList host_get_parameters(void* host) {
    FFIParameterList list;
    list.parameters = nullptr;
    list.count = 0;

    if (!host) return list;

    std::vector<ParameterInfo> params = static_cast<PluginHost*>(host)->getParameters();
    if (params.empty()) return list;

    FFIParameter* ffiParams = new FFIParameter[params.size()];
    for (size_t i = 0; i < params.size(); ++i) {
        ffiParams[i].index = params[i].index;
        ffiParams[i].value = params[i].value;
        ffiParams[i].min_value = params[i].minValue;
        ffiParams[i].max_value = params[i].maxValue;
        ffiParams[i].default_value = params[i].defaultValue;

        char* nameStr = new char[params[i].name.length() + 1];
        std::strcpy(nameStr, params[i].name.c_str());
        ffiParams[i].name = nameStr;
        allocatedStrings.push_back(nameStr);
    }

    list.parameters = ffiParams;
    list.count = static_cast<int32_t>(params.size());
    allocatedParameters.push_back(ffiParams);

    return list;
}

void host_free_parameter_list(FFIParameterList list) {
    if (list.parameters) {
        for (int32_t i = 0; i < list.count; ++i) {
            delete[] list.parameters[i].name;
        }
        delete[] list.parameters;
    }
}

void host_set_parameter_value(void* host, int32_t index, float value) {
    if (host) {
        static_cast<PluginHost*>(host)->setParameterValue(index, value);
    }
}

void host_adjust_parameter_value(void* host, int32_t index, float delta) {
    if (host) {
        static_cast<PluginHost*>(host)->adjustParameterValue(index, delta);
    }
}

float host_get_parameter_value(void* host, int32_t index) {
    if (!host) return 0.0f;
    return static_cast<PluginHost*>(host)->getParameterValue(index);
}

}
