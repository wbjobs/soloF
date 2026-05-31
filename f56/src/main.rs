mod ffi;

use eframe::egui;
use ffi::{Parameter, PluginHost};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
struct KeyMapping {
    param_index: usize,
    param_name: String,
    direction: MappingDirection,
    step_size: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MappingDirection {
    Increase,
    Decrease,
}

#[derive(Clone, Debug)]
struct LearningState {
    param_index: usize,
    param_name: String,
    direction: MappingDirection,
}

struct HostApp {
    host: Arc<PluginHost>,
    plugin_path: String,
    plugin_name: String,
    parameters: Vec<Parameter>,
    audio_initialized: bool,
    status_message: String,
    show_file_dialog: bool,
    last_refresh: Instant,
    plugin_loaded_cache: bool,
    key_mappings: HashMap<String, KeyMapping>,
    learning_state: Option<LearningState>,
    show_midi_panel: bool,
    key_step_size: f32,
}

impl HostApp {
    fn new(_cc: &eframe::CreationContext<'_>) -> Self {
        let host = Arc::new(PluginHost::new());
        let audio_initialized = host.initialize_audio();

        Self {
            host,
            plugin_path: String::new(),
            plugin_name: String::new(),
            parameters: Vec::new(),
            audio_initialized,
            status_message: if audio_initialized {
                "Audio device initialized".to_string()
            } else {
                "Failed to initialize audio device".to_string()
            },
            show_file_dialog: false,
            last_refresh: Instant::now(),
            plugin_loaded_cache: false,
            key_mappings: HashMap::new(),
            learning_state: None,
            show_midi_panel: true,
            key_step_size: 0.05,
        }
    }

    fn load_plugin(&mut self, path: &str) {
        if self.host.is_plugin_loaded() {
            self.host.unload_plugin();
            self.plugin_loaded_cache = false;
        }

        self.key_mappings.clear();
        self.learning_state = None;

        if self.host.load_plugin(path) {
            self.plugin_name = self.host.get_plugin_name();
            self.parameters = self.host.get_parameters();
            self.plugin_loaded_cache = true;
            self.status_message = format!("Loaded plugin: {}", self.plugin_name);
        } else {
            self.plugin_name.clear();
            self.parameters.clear();
            self.plugin_loaded_cache = false;
            self.status_message = format!("Failed to load plugin: {}", path);
        }
    }

    fn refresh_parameters_if_needed(&mut self) {
        const REFRESH_INTERVAL: Duration = Duration::from_millis(50);

        if self.plugin_loaded_cache && self.last_refresh.elapsed() >= REFRESH_INTERVAL {
            for param in self.parameters.iter_mut() {
                param.value = self.host.get_parameter_value(param.index);
            }
            self.last_refresh = Instant::now();
        }
    }

    fn handle_keyboard_input(&mut self, ctx: &egui::Context) {
        if !self.plugin_loaded_cache {
            return;
        }

        let mut keys_pressed: Vec<String> = Vec::new();
        ctx.input(|i| {
            for (key, pressed) in &i.keys {
                if *pressed {
                    keys_pressed.push(format!("{:?}", key));
                }
            }
        });

        if let Some(learning) = self.learning_state.clone() {
            if !keys_pressed.is_empty() {
                let key = keys_pressed[0].clone();
                let mapping = KeyMapping {
                    param_index: learning.param_index,
                    param_name: learning.param_name.clone(),
                    direction: learning.direction,
                    step_size: self.key_step_size,
                };
                self.key_mappings.insert(key.clone(), mapping);
                self.learning_state = None;
                self.status_message = format!(
                    "Mapped key '{}' to {} ({:?})",
                    key, learning.param_name, learning.direction
                );
            }
            return;
        }

        for key in keys_pressed {
            if let Some(mapping) = self.key_mappings.get(&key) {
                let delta = match mapping.direction {
                    MappingDirection::Increase => mapping.step_size,
                    MappingDirection::Decrease => -mapping.step_size,
                };
                self.host.adjust_parameter_value(mapping.param_index, delta);
                if let Some(param) = self
                    .parameters
                    .iter_mut()
                    .find(|p| p.index == mapping.param_index)
                {
                    param.value = self.host.get_parameter_value(mapping.param_index);
                }
            }
        }
    }

    fn start_learning(&mut self, param_index: usize, param_name: &str, direction: MappingDirection) {
        self.learning_state = Some(LearningState {
            param_index,
            param_name: param_name.to_string(),
            direction,
        });
        self.status_message = format!(
            "Press a key to map to {} ({:?})...",
            param_name, direction
        );
    }

    fn remove_mapping(&mut self, key: &str) {
        if self.key_mappings.remove(key).is_some() {
            self.status_message = format!("Removed mapping for key '{}'", key);
        }
    }

    fn clear_all_mappings(&mut self) {
        self.key_mappings.clear();
        self.status_message = "Cleared all keyboard mappings".to_string();
    }
}

impl eframe::App for HostApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.handle_keyboard_input(ctx);
        self.refresh_parameters_if_needed();

        egui::TopBottomPanel::top("top_panel").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading("VST3 Plugin Host");
                ui.separator();
                ui.label(&self.status_message);
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.checkbox(&mut self.show_midi_panel, "MIDI Learn");
                });
            });
        });

        egui::TopBottomPanel::bottom("bottom_panel").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.label(format!("Audio: {}", if self.audio_initialized { "✓" } else { "✗" }));
                ui.separator();
                ui.label(format!(
                    "Plugin: {}",
                    if self.plugin_loaded_cache {
                        &self.plugin_name
                    } else {
                        "None"
                    }
                ));
                ui.separator();
                ui.label(format!("Mappings: {}", self.key_mappings.len()));
            });
        });

        if self.show_midi_panel {
            egui::SidePanel::right("midi_panel")
                .default_width(320.0)
                .resizable(true)
                .show(ctx, |ui| {
                    ui.heading("MIDI Learn - Keyboard Mappings");
                    ui.add_space(8.0);

                    ui.label("Step size per key press:");
                    ui.add(egui::Slider::new(&mut self.key_step_size, 0.001..=0.2).fixed_decimals(3));

                    ui.add_space(8.0);

                    if self.learning_state.is_some() {
                        ui.colored_label(
                            egui::Color32::YELLOW,
                            "🔴 Press any key to complete mapping...",
                        );
                        if ui.button("Cancel Learning").clicked() {
                            self.learning_state = None;
                            self.status_message = "Learning cancelled".to_string();
                        }
                        ui.add_space(8.0);
                    }

                    ui.separator();
                    ui.label("Active Mappings:");
                    ui.add_space(4.0);

                    if self.key_mappings.is_empty() {
                        ui.label("No mappings defined.");
                        ui.label("Click + / - buttons next to parameters to map keys.");
                    } else {
                        let mut mappings_to_remove: Vec<String> = Vec::new();

                        for (key, mapping) in &self.key_mappings {
                            ui.horizontal(|ui| {
                                let dir_str = match mapping.direction {
                                    MappingDirection::Increase => "▲",
                                    MappingDirection::Decrease => "▼",
                                };
                                ui.label(format!("[{}]", key));
                                ui.label(format!("{} {}", dir_str, mapping.param_name));
                                ui.with_layout(
                                    egui::Layout::right_to_left(egui::Align::Center),
                                    |ui| {
                                        if ui.small_button("✕").clicked() {
                                            mappings_to_remove.push(key.clone());
                                        }
                                    },
                                );
                            });
                        }

                        for key in mappings_to_remove {
                            self.remove_mapping(&key);
                        }

                        ui.add_space(8.0);
                        if ui.button("Clear All Mappings").clicked() {
                            self.clear_all_mappings();
                        }
                    }

                    ui.add_space(8.0);
                    ui.separator();
                    ui.label("Instructions:");
                    ui.label("1. Click + to map a key for increasing parameter");
                    ui.label("2. Click - to map a key for decreasing parameter");
                    ui.label("3. Press any key to complete the mapping");
                    ui.label("4. Use mapped keys to control parameters");
                });
        }

        egui::SidePanel::left("side_panel")
            .default_width(280.0)
            .show(ctx, |ui| {
                ui.heading("Plugin Control");
                ui.add_space(8.0);

                ui.label("Plugin Path:");
                ui.text_edit_singleline(&mut self.plugin_path);

                ui.horizontal(|ui| {
                    if ui.button("Browse...").clicked() {
                        self.show_file_dialog = true;
                    }

                    if ui.button("Load").clicked() && !self.plugin_path.is_empty() {
                        let path = self.plugin_path.clone();
                        self.load_plugin(&path);
                    }
                });

                if ui.button("Unload").clicked() {
                    self.host.unload_plugin();
                    self.plugin_name.clear();
                    self.parameters.clear();
                    self.key_mappings.clear();
                    self.learning_state = None;
                    self.plugin_loaded_cache = false;
                    self.status_message = "Plugin unloaded".to_string();
                }

                ui.separator();

                if ui.button("Refresh Parameters").clicked() {
                    if self.plugin_loaded_cache {
                        self.parameters = self.host.get_parameters();
                        self.status_message = "Parameters refreshed".to_string();
                    }
                }
            });

        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("Parameters");
            ui.add_space(8.0);

            if self.parameters.is_empty() {
                ui.label("No plugin loaded. Load a VST3 plugin to see its parameters.");
            } else {
                egui::ScrollArea::vertical().show(ui, |ui| {
                    for param in self.parameters.iter_mut() {
                        ui.horizontal(|ui| {
                            if ui.small_button("+").on_hover_text(format!("Map key to increase {}", param.name)).clicked() {
                                self.start_learning(param.index, &param.name, MappingDirection::Increase);
                            }
                            if ui.small_button("-").on_hover_text(format!("Map key to decrease {}", param.name)).clicked() {
                                self.start_learning(param.index, &param.name, MappingDirection::Decrease);
                            }

                            ui.label(format!("{}:", param.name));
                            let response = ui.add(
                                egui::Slider::new(&mut param.value, 0.0..=1.0)
                                    .show_value(true)
                                    .fixed_decimals(4),
                            );
                            if response.changed() {
                                self.host.set_parameter_value(param.index, param.value);
                            }
                            if ui.button("Reset").clicked() {
                                param.value = param.default_value;
                                self.host.set_parameter_value(param.index, param.default_value);
                            }
                        });
                    }
                });
            }
        });

        if self.show_file_dialog {
            egui::Window::new("Select VST3 Plugin")
                .collapsible(false)
                .resizable(false)
                .show(ctx, |ui| {
                    ui.label("Enter path to VST3 plugin:");
                    ui.text_edit_singleline(&mut self.plugin_path);
                    ui.horizontal(|ui| {
                        if ui.button("OK").clicked() {
                            self.show_file_dialog = false;
                            if !self.plugin_path.is_empty() {
                                let path = self.plugin_path.clone();
                                self.load_plugin(&path);
                            }
                        }
                        if ui.button("Cancel").clicked() {
                            self.show_file_dialog = false;
                        }
                    });
                });
        }

        ctx.request_repaint_after(Duration::from_millis(16));
    }
}

fn main() -> Result<(), eframe::Error> {
    let options = eframe::NativeOptions {
        initial_window_size: Some(egui::vec2(1100.0, 700.0)),
        min_window_size: Some(egui::vec2(800.0, 500.0)),
        ..Default::default()
    };

    eframe::run_native(
        "VST3 Plugin Host",
        options,
        Box::new(|cc| Box::new(HostApp::new(cc))),
    )
}
