use libc::{c_char, c_float, c_int, c_void};
use std::ffi::{CStr, CString};
use std::ptr;

#[repr(C)]
pub struct FFIParameter {
    pub index: c_int,
    pub name: *const c_char,
    pub value: c_float,
    pub min_value: c_float,
    pub max_value: c_float,
    pub default_value: c_float,
}

#[repr(C)]
pub struct FFIParameterList {
    pub parameters: *mut FFIParameter,
    pub count: c_int,
}

extern "C" {
    pub fn host_create() -> *mut c_void;
    pub fn host_destroy(host: *mut c_void);
    pub fn host_initialize_audio(host: *mut c_void) -> c_int;
    pub fn host_shutdown_audio(host: *mut c_void);
    pub fn host_load_plugin(host: *mut c_void, plugin_path: *const c_char) -> c_int;
    pub fn host_unload_plugin(host: *mut c_void);
    pub fn host_is_plugin_loaded(host: *mut c_void) -> c_int;
    pub fn host_get_plugin_name(host: *mut c_void) -> *const c_char;
    pub fn host_get_parameters(host: *mut c_void) -> FFIParameterList;
    pub fn host_free_parameter_list(list: FFIParameterList);
    pub fn host_set_parameter_value(host: *mut c_void, index: c_int, value: c_float);
    pub fn host_adjust_parameter_value(host: *mut c_void, index: c_int, delta: c_float);
    pub fn host_get_parameter_value(host: *mut c_void, index: c_int) -> c_float;
}

#[derive(Clone)]
pub struct Parameter {
    pub index: usize,
    pub name: String,
    pub value: f32,
    pub min_value: f32,
    pub max_value: f32,
    pub default_value: f32,
}

pub struct PluginHost {
    ptr: *mut c_void,
}

unsafe impl Send for PluginHost {}
unsafe impl Sync for PluginHost {}

impl PluginHost {
    pub fn new() -> Self {
        PluginHost {
            ptr: unsafe { host_create() },
        }
    }

    pub fn initialize_audio(&self) -> bool {
        unsafe { host_initialize_audio(self.ptr) != 0 }
    }

    pub fn shutdown_audio(&self) {
        unsafe { host_shutdown_audio(self.ptr) };
    }

    pub fn load_plugin(&self, path: &str) -> bool {
        let c_path = CString::new(path).unwrap();
        unsafe { host_load_plugin(self.ptr, c_path.as_ptr()) != 0 }
    }

    pub fn unload_plugin(&self) {
        unsafe { host_unload_plugin(self.ptr) };
    }

    pub fn is_plugin_loaded(&self) -> bool {
        unsafe { host_is_plugin_loaded(self.ptr) != 0 }
    }

    pub fn get_plugin_name(&self) -> String {
        let name_ptr = unsafe { host_get_plugin_name(self.ptr) };
        if name_ptr.is_null() {
            return String::new();
        }
        let c_str = unsafe { CStr::from_ptr(name_ptr) };
        c_str.to_string_lossy().into_owned()
    }

    pub fn get_parameters(&self) -> Vec<Parameter> {
        let list = unsafe { host_get_parameters(self.ptr) };
        let mut params = Vec::new();

        if list.count > 0 && !list.parameters.is_null() {
            for i in 0..list.count {
                let param_ptr = unsafe { list.parameters.offset(i as isize) };
                let ffi_param = unsafe { &*param_ptr };

                let name = if !ffi_param.name.is_null() {
                    unsafe { CStr::from_ptr(ffi_param.name) }
                        .to_string_lossy()
                        .into_owned()
                } else {
                    String::new()
                };

                params.push(Parameter {
                    index: ffi_param.index as usize,
                    name,
                    value: ffi_param.value,
                    min_value: ffi_param.min_value,
                    max_value: ffi_param.max_value,
                    default_value: ffi_param.default_value,
                });
            }
        }

        unsafe { host_free_parameter_list(list) };
        params
    }

    pub fn set_parameter_value(&self, index: usize, value: f32) {
        unsafe { host_set_parameter_value(self.ptr, index as c_int, value) };
    }

    pub fn adjust_parameter_value(&self, index: usize, delta: f32) {
        unsafe { host_adjust_parameter_value(self.ptr, index as c_int, delta) };
    }

    pub fn get_parameter_value(&self, index: usize) -> f32 {
        unsafe { host_get_parameter_value(self.ptr, index as c_int) }
    }
}

impl Drop for PluginHost {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            unsafe { host_destroy(self.ptr) };
            self.ptr = ptr::null_mut();
        }
    }
}
