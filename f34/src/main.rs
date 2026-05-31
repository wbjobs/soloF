mod map_generation;
mod render;

use bevy::prelude::*;
use map_generation::DungeonMap;
use render::RenderPlugin;

const MAP_WIDTH: i32 = 40;
const MAP_HEIGHT: i32 = 30;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "BSP 地牢生成器".to_string(),
                resolution: (900.0, 700.0).into(),
                ..default()
            }),
            ..default()
        }))
        .insert_resource(DungeonMap::new(MAP_WIDTH, MAP_HEIGHT))
        .add_plugins(RenderPlugin)
        .add_systems(Update, regenerate_dungeon)
        .run();
}

fn regenerate_dungeon(
    keyboard_input: Res<ButtonInput<KeyCode>>,
    mut dungeon_map: ResMut<DungeonMap>,
) {
    if keyboard_input.just_pressed(KeyCode::Space) {
        *dungeon_map = DungeonMap::new(MAP_WIDTH, MAP_HEIGHT);
    }
}
