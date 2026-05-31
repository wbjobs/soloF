use bevy::prelude::*;
use rand::Rng;
use std::cmp;

#[derive(Component, Clone, Copy, Debug)]
pub struct Room {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Room {
    pub fn center(&self) -> (i32, i32) {
        (self.x + self.width / 2, self.y + self.height / 2)
    }

    pub fn area(&self) -> i32 {
        self.width * self.height
    }

    pub fn intersects(&self, other: &Room) -> bool {
        self.x < other.x + other.width
            && self.x + self.width > other.x
            && self.y < other.y + other.height
            && self.y + self.height > other.y
    }

    pub fn intersects_with_margin(&self, other: &Room, margin: i32) -> bool {
        self.x - margin < other.x + other.width
            && self.x + self.width + margin > other.x
            && self.y - margin < other.y + other.height
            && self.y + self.height + margin > other.y
    }
}

#[derive(Component, Clone, Copy, Debug)]
pub struct Corridor {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
}

#[derive(Resource)]
pub struct DungeonMap {
    pub width: i32,
    pub height: i32,
    pub rooms: Vec<Room>,
    pub corridors: Vec<Corridor>,
    pub tiles: Vec<Vec<bool>>,
    pub boss_room_index: Option<usize>,
}

struct BSPNode {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    left: Option<Box<BSPNode>>,
    right: Option<Box<BSPNode>>,
}

impl BSPNode {
    fn new(x: i32, y: i32, width: i32, height: i32) -> Self {
        BSPNode {
            x,
            y,
            width,
            height,
            left: None,
            right: None,
        }
    }

    fn split(&mut self, rng: &mut rand::rngs::ThreadRng, depth: usize) {
        if depth == 0 {
            return;
        }

        let min_size = 8;
        if self.width < min_size * 2 && self.height < min_size * 2 {
            return;
        }

        let split_horizontally = if self.width > self.height * 1.25 {
            false
        } else if self.height > self.width * 1.25 {
            true
        } else {
            rng.gen_bool(0.5)
        };

        if split_horizontally {
            if self.height < min_size * 2 {
                return;
            }
            let split_range = min_size..self.height - min_size;
            if !split_range.is_empty() {
                let split = rng.gen_range(split_range);
                self.left = Some(Box::new(BSPNode::new(
                    self.x,
                    self.y,
                    self.width,
                    split,
                )));
                self.right = Some(Box::new(BSPNode::new(
                    self.x,
                    self.y + split,
                    self.width,
                    self.height - split,
                )));
            }
        } else {
            if self.width < min_size * 2 {
                return;
            }
            let split_range = min_size..self.width - min_size;
            if !split_range.is_empty() {
                let split = rng.gen_range(split_range);
                self.left = Some(Box::new(BSPNode::new(
                    self.x,
                    self.y,
                    split,
                    self.height,
                )));
                self.right = Some(Box::new(BSPNode::new(
                    self.x + split,
                    self.y,
                    self.width - split,
                    self.height,
                )));
            }
        }

        if let Some(left) = &mut self.left {
            left.split(rng, depth - 1);
        }
        if let Some(right) = &mut self.right {
            right.split(rng, depth - 1);
        }
    }

    fn create_rooms(
        &self,
        rng: &mut rand::rngs::ThreadRng,
        rooms: &mut Vec<Room>,
        max_attempts: usize,
    ) {
        if self.left.is_none() && self.right.is_none() {
            let margin = 2;
            let min_room_size = 3;
            let max_room_width = cmp::max(min_room_size, self.width - margin * 2 - 1);
            let max_room_height = cmp::max(min_room_size, self.height - margin * 2 - 1);

            for _ in 0..max_attempts {
                let room_width = rng.gen_range(min_room_size..=max_room_width);
                let room_height = rng.gen_range(min_room_size..=max_room_height);

                let x_range = margin..=self.width - room_width - margin;
                let y_range = margin..=self.height - room_height - margin;

                if x_range.is_empty() || y_range.is_empty() {
                    continue;
                }

                let room_x = self.x + rng.gen_range(x_range);
                let room_y = self.y + rng.gen_range(y_range);

                let new_room = Room {
                    x: room_x,
                    y: room_y,
                    width: room_width,
                    height: room_height,
                };

                let mut overlaps = false;
                for existing_room in rooms.iter() {
                    if new_room.intersects_with_margin(existing_room, 1) {
                        overlaps = true;
                        break;
                    }
                }

                if !overlaps {
                    rooms.push(new_room);
                    break;
                }
            }
            return;
        }

        if let Some(left) = &self.left {
            left.create_rooms(rng, rooms, max_attempts);
        }
        if let Some(right) = &self.right {
            right.create_rooms(rng, rooms, max_attempts);
        }
    }
}

impl DungeonMap {
    pub fn new(width: i32, height: i32) -> Self {
        let mut rng = rand::thread_rng();
        let mut root = BSPNode::new(1, 1, width - 2, height - 2);
        root.split(&mut rng, 6);

        let mut rooms = Vec::new();
        root.create_rooms(&mut rng, &mut rooms, 20);

        let boss_room_index = Self::find_largest_room(&rooms);

        let corridors = Self::create_corridors(&rooms, &mut rng);

        let mut tiles = vec![vec![false; height as usize]; width as usize];
        Self::fill_tiles(&mut tiles, &rooms, &corridors);

        DungeonMap {
            width,
            height,
            rooms,
            corridors,
            tiles,
            boss_room_index,
        }
    }

    fn find_largest_room(rooms: &[Room]) -> Option<usize> {
        if rooms.is_empty() {
            return None;
        }

        let mut max_area = -1;
        let mut max_index = 0;

        for (i, room) in rooms.iter().enumerate() {
            let area = room.area();
            if area > max_area {
                max_area = area;
                max_index = i;
            }
        }

        Some(max_index)
    }

    fn create_corridors(rooms: &[Room], rng: &mut rand::rngs::ThreadRng) -> Vec<Corridor> {
        let mut corridors = Vec::new();

        if rooms.is_empty() {
            return corridors;
        }

        let mut connected = vec![false; rooms.len()];
        connected[0] = true;

        while connected.iter().any(|&c| !c) {
            let mut min_dist = i32::MAX;
            let mut best_from = 0;
            let mut best_to = 0;

            for (i, &is_connected) in connected.iter().enumerate() {
                if !is_connected {
                    continue;
                }
                for (j, &is_j_connected) in connected.iter().enumerate() {
                    if is_j_connected || i == j {
                        continue;
                    }
                    let (x1, y1) = rooms[i].center();
                    let (x2, y2) = rooms[j].center();
                    let dist = (x1 - x2).abs() + (y1 - y2).abs();
                    if dist < min_dist {
                        min_dist = dist;
                        best_from = i;
                        best_to = j;
                    }
                }
            }

            if min_dist == i32::MAX {
                break;
            }

            connected[best_to] = true;

            let (x1, y1) = rooms[best_from].center();
            let (x2, y2) = rooms[best_to].center();

            if rng.gen_bool(0.5) {
                corridors.push(Corridor {
                    x1,
                    y1,
                    x2,
                    y2: y1,
                });
                corridors.push(Corridor {
                    x1: x2,
                    y1,
                    x2,
                    y2,
                });
            } else {
                corridors.push(Corridor {
                    x1,
                    y1,
                    x2: x1,
                    y2,
                });
                corridors.push(Corridor {
                    x1,
                    y1: y2,
                    x2,
                    y2,
                });
            }
        }

        corridors
    }

    fn fill_tiles(tiles: &mut [Vec<bool>], rooms: &[Room], corridors: &[Corridor]) {
        for room in rooms {
            for y in room.y..room.y + room.height {
                for x in room.x..room.x + room.width {
                    if x >= 0 && y >= 0 && x < tiles.len() as i32 && y < tiles[0].len() as i32 {
                        tiles[x as usize][y as usize] = true;
                    }
                }
            }
        }

        for corridor in corridors {
            let (mut x, mut y) = (corridor.x1, corridor.y1);
            let (target_x, target_y) = (corridor.x2, corridor.y2);

            let dx = (target_x - x).signum();
            let dy = (target_y - y).signum();

            while x != target_x {
                if x >= 0 && y >= 0 && x < tiles.len() as i32 && y < tiles[0].len() as i32 {
                    tiles[x as usize][y as usize] = true;
                    if y > 0 {
                        tiles[x as usize][(y - 1) as usize] = true;
                    }
                }
                x += dx;
            }

            while y != target_y {
                if x >= 0 && y >= 0 && x < tiles.len() as i32 && y < tiles[0].len() as i32 {
                    tiles[x as usize][y as usize] = true;
                    if x > 0 {
                        tiles[(x - 1) as usize][y as usize] = true;
                    }
                }
                y += dy;
            }

            if x >= 0 && y >= 0 && x < tiles.len() as i32 && y < tiles[0].len() as i32 {
                tiles[x as usize][y as usize] = true;
            }
        }
    }
}
