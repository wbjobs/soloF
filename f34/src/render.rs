use bevy::prelude::*;
use crate::map_generation::{DungeonMap, Room, Corridor};

const TILE_SIZE: f32 = 20.0;
const WALL_COLOR: Color = Color::rgb(0.1, 0.1, 0.1);
const FLOOR_COLOR: Color = Color::rgb(0.6, 0.6, 0.6);
const BOSS_MARKER_COLOR: Color = Color::rgb(1.0, 0.0, 0.0);
const ROOM_COLORS: &[Color] = &[
    Color::rgb(0.8, 0.2, 0.2),
    Color::rgb(0.2, 0.8, 0.2),
    Color::rgb(0.2, 0.2, 0.8),
    Color::rgb(0.8, 0.8, 0.2),
    Color::rgb(0.8, 0.2, 0.8),
    Color::rgb(0.2, 0.8, 0.8),
];

pub struct RenderPlugin;

impl Plugin for RenderPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, setup_camera)
            .add_systems(Update, render_dungeon);
    }
}

fn setup_camera(mut commands: Commands) {
    commands.spawn(Camera2dBundle::default());
}

fn render_dungeon(
    mut commands: Commands,
    dungeon_map: Res<DungeonMap>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<ColorMaterial>>,
    existing_tiles: Query<Entity, With<Tile>>,
) {
    for entity in existing_tiles.iter() {
        commands.entity(entity).despawn();
    }

    let floor_material = materials.add(FLOOR_COLOR);
    let wall_material = materials.add(WALL_COLOR);
    let mesh = meshes.add(Rectangle::from_length(TILE_SIZE));

    let offset_x = -(dungeon_map.width as f32 * TILE_SIZE) / 2.0;
    let offset_y = -(dungeon_map.height as f32 * TILE_SIZE) / 2.0;

    for x in 0..dungeon_map.width {
        for y in 0..dungeon_map.height {
            let is_floor = dungeon_map.tiles[x as usize][y as usize];
            let material = if is_floor {
                floor_material.clone()
            } else {
                wall_material.clone()
            };

            commands.spawn((
                SpriteBundle {
                    sprite: Sprite {
                        color: if is_floor { FLOOR_COLOR } else { WALL_COLOR },
                        custom_size: Some(Vec2::new(TILE_SIZE, TILE_SIZE)),
                        ..default()
                    },
                    transform: Transform::from_xyz(
                        offset_x + x as f32 * TILE_SIZE + TILE_SIZE / 2.0,
                        offset_y + y as f32 * TILE_SIZE + TILE_SIZE / 2.0,
                        if is_floor { 0.0 } else { 1.0 },
                    ),
                    ..default()
                },
                Tile,
            ));
        }
    }

    for (i, room) in dungeon_map.rooms.iter().enumerate() {
        let room_color = ROOM_COLORS[i % ROOM_COLORS.len()];
        spawn_room_border(&mut commands, room, room_color, offset_x, offset_y);
    }

    if let Some(boss_room_idx) = dungeon_map.boss_room_index {
        if let Some(boss_room) = dungeon_map.rooms.get(boss_room_idx) {
            spawn_boss_marker(&mut commands, boss_room, offset_x, offset_y);
        }
    }
}

fn spawn_room_border(
    commands: &mut Commands,
    room: &Room,
    color: Color,
    offset_x: f32,
    offset_y: f32,
) {
    let border_thickness = 2.0;

    commands.spawn(SpriteBundle {
        sprite: Sprite {
            color,
            custom_size: Some(Vec2::new(room.width as f32 * TILE_SIZE, border_thickness)),
            ..default()
        },
        transform: Transform::from_xyz(
            offset_x + room.x as f32 * TILE_SIZE + room.width as f32 * TILE_SIZE / 2.0,
            offset_y + room.y as f32 * TILE_SIZE - border_thickness / 2.0,
            2.0,
        ),
        ..default()
    });

    commands.spawn(SpriteBundle {
        sprite: Sprite {
            color,
            custom_size: Some(Vec2::new(room.width as f32 * TILE_SIZE, border_thickness)),
            ..default()
        },
        transform: Transform::from_xyz(
            offset_x + room.x as f32 * TILE_SIZE + room.width as f32 * TILE_SIZE / 2.0,
            offset_y + (room.y + room.height) as f32 * TILE_SIZE - border_thickness / 2.0,
            2.0,
        ),
        ..default()
    });

    commands.spawn(SpriteBundle {
        sprite: Sprite {
            color,
            custom_size: Some(Vec2::new(border_thickness, room.height as f32 * TILE_SIZE)),
            ..default()
        },
        transform: Transform::from_xyz(
            offset_x + room.x as f32 * TILE_SIZE - border_thickness / 2.0,
            offset_y + room.y as f32 * TILE_SIZE + room.height as f32 * TILE_SIZE / 2.0,
            2.0,
        ),
        ..default()
    });

    commands.spawn(SpriteBundle {
        sprite: Sprite {
            color,
            custom_size: Some(Vec2::new(border_thickness, room.height as f32 * TILE_SIZE)),
            ..default()
        },
        transform: Transform::from_xyz(
            offset_x + (room.x + room.width) as f32 * TILE_SIZE - border_thickness / 2.0,
            offset_y + room.y as f32 * TILE_SIZE + room.height as f32 * TILE_SIZE / 2.0,
            2.0,
        ),
        ..default()
    });
}

fn spawn_boss_marker(
    commands: &mut Commands,
    boss_room: &Room,
    offset_x: f32,
    offset_y: f32,
) {
    let (center_x, center_y) = boss_room.center();
    let marker_size = TILE_SIZE * 1.5;

    commands.spawn(SpriteBundle {
        sprite: Sprite {
            color: BOSS_MARKER_COLOR,
            custom_size: Some(Vec2::new(marker_size, marker_size)),
            ..default()
        },
        transform: Transform::from_xyz(
            offset_x + center_x as f32 * TILE_SIZE,
            offset_y + center_y as f32 * TILE_SIZE,
            3.0,
        ),
        ..default()
    });
}

#[derive(Component)]
struct Tile;
