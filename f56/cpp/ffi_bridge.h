#pragma once

#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

struct FFIParameter {
    int32_t index;
    const char* name;
    float value;
    float min_value;
    float max_value;
    float default_value;
};

struct FFIParameterList {
    FFIParameter* parameters;
    int32_t count;
};

void* host_create();
void host_destroy(void* host);
int host_initialize_audio(void* host);
void host_shutdown_audio(void* host);
int host_load_plugin(void* host, const char* plugin_path);
void host_unload_plugin(void* host);
int host_is_plugin_loaded(void* host);
const char* host_get_plugin_name(void* host);
FFIParameterList host_get_parameters(void* host);
void host_free_parameter_list(FFIParameterList list);
void host_set_parameter_value(void* host, int32_t index, float value);
void host_adjust_parameter_value(void* host, int32_t index, float delta);
float host_get_parameter_value(void* host, int32_t index);

#ifdef __cplusplus
}
#endif
