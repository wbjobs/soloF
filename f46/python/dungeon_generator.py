import numpy as np
from scipy.ndimage import convolve, binary_dilation, binary_erosion
from scipy.spatial import Voronoi
import random


class DungeonGenerator:
    def __init__(self, width=80, height=60, seed=None):
        self.width = width
        self.height = height
        self.seed = seed if seed is not None else random.randint(0, 999999)
        np.random.seed(self.seed)
        random.seed(self.seed)

    def generate_cellular_automaton(self, fill_probability=0.45, iterations=5, birth_limit=4, death_limit=3):
        grid = np.random.choice([0, 1], size=(self.height, self.width), 
                                p=[1-fill_probability, fill_probability])
        
        for _ in range(iterations):
            new_grid = grid.copy()
            for y in range(self.height):
                for x in range(self.width):
                    neighbors = self._count_neighbors(grid, x, y)
                    if grid[y, x] == 1:
                        if neighbors < death_limit:
                            new_grid[y, x] = 0
                    else:
                        if neighbors > birth_limit:
                            new_grid[y, x] = 1
            grid = new_grid
        
        return grid

    def _count_neighbors(self, grid, x, y):
        count = 0
        for dy in range(-1, 2):
            for dx in range(-1, 2):
                if dx == 0 and dy == 0:
                    continue
                nx, ny = x + dx, y + dy
                if 0 <= nx < self.width and 0 <= ny < self.height:
                    if grid[ny, nx] == 1:
                        count += 1
                else:
                    count += 1
        return count

    def generate_simple_noise(self, scale=10.0, octaves=3, persistence=0.5, lacunarity=2.0, threshold=0.5):
        grid = np.zeros((self.height, self.width))
        for y in range(self.height):
            for x in range(self.width):
                value = 0.0
                amplitude = 1.0
                frequency = 1.0
                max_value = 0.0
                
                for _ in range(octaves):
                    sample_x = x / scale * frequency
                    sample_y = y / scale * frequency
                    value += self._noise(sample_x, sample_y) * amplitude
                    max_value += amplitude
                    amplitude *= persistence
                    frequency *= lacunarity
                
                grid[y, x] = value / max_value
        
        return (grid > threshold).astype(int)

    def _noise(self, x, y):
        n = int(x) + int(y) * 57
        n = (n << 13) ^ n
        return 1.0 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0

    def generate_rooms_and_corridors(self, room_min_size=5, room_max_size=12, num_rooms=15, corridor_width=2):
        grid = np.ones((self.height, self.width), dtype=int)
        rooms = []
        
        for _ in range(num_rooms * 3):
            w = random.randint(room_min_size, room_max_size)
            h = random.randint(room_min_size, room_max_size)
            x = random.randint(1, self.width - w - 1)
            y = random.randint(1, self.height - h - 1)
            
            new_room = (x, y, w, h)
            overlap = False
            for room in rooms:
                if self._rooms_overlap(new_room, room, margin=2):
                    overlap = True
                    break
            
            if not overlap:
                self._carve_room(grid, new_room)
                if rooms:
                    prev_center = (rooms[-1][0] + rooms[-1][2]//2, rooms[-1][1] + rooms[-1][3]//2)
                    curr_center = (x + w//2, y + h//2)
                    self._carve_corridor(grid, prev_center, curr_center, corridor_width)
                rooms.append(new_room)
                if len(rooms) >= num_rooms:
                    break
        
        return grid

    def _rooms_overlap(self, room1, room2, margin=0):
        x1, y1, w1, h1 = room1
        x2, y2, w2, h2 = room2
        return (x1 - margin < x2 + w2 + margin and
                x1 + w1 + margin > x2 - margin and
                y1 - margin < y2 + h2 + margin and
                y1 + h1 + margin > y2 - margin)

    def _carve_room(self, grid, room):
        x, y, w, h = room
        grid[y:y+h, x:x+w] = 0

    def _carve_corridor(self, grid, start, end, width=1):
        x1, y1 = start
        x2, y2 = end
        
        if random.choice([True, False]):
            self._h_corridor(grid, x1, x2, y1, width)
            self._v_corridor(grid, y1, y2, x2, width)
        else:
            self._v_corridor(grid, y1, y2, x1, width)
            self._h_corridor(grid, x1, x2, y2, width)

    def _h_corridor(self, grid, x1, x2, y, width):
        for x in range(min(x1, x2), max(x1, x2) + 1):
            for dy in range(-width//2, width//2 + 1):
                ny = y + dy
                if 0 <= ny < self.height and 0 <= x < self.width:
                    grid[ny, x] = 0

    def _v_corridor(self, grid, y1, y2, x, width):
        for y in range(min(y1, y2), max(y1, y2) + 1):
            for dx in range(-width//2, width//2 + 1):
                nx = x + dx
                if 0 <= y < self.height and 0 <= nx < self.width:
                    grid[y, nx] = 0

    def apply_morphology(self, grid, operation='dilate', iterations=1):
        if operation == 'dilate':
            return binary_dilation(grid, iterations=iterations).astype(int)
        elif operation == 'erode':
            return binary_erosion(grid, iterations=iterations).astype(int)
        elif operation == 'open':
            return binary_dilation(binary_erosion(grid, iterations=iterations), 
                                   iterations=iterations).astype(int)
        elif operation == 'close':
            return binary_erosion(binary_dilation(grid, iterations=iterations), 
                                   iterations=iterations).astype(int)
        return grid

    def smooth_edges(self, grid, kernel_size=3):
        kernel = np.ones((kernel_size, kernel_size))
        convolved = convolve(grid, kernel, mode='constant', cval=1)
        threshold = (kernel_size * kernel_size) // 2
        return (convolved > threshold).astype(int)

    def generate_hybrid(self, **kwargs):
        ca_grid = self.generate_cellular_automaton(
            fill_probability=kwargs.get('fill_probability', 0.45),
            iterations=kwargs.get('ca_iterations', 5),
            birth_limit=kwargs.get('birth_limit', 4),
            death_limit=kwargs.get('death_limit', 3)
        )
        
        room_grid = self.generate_rooms_and_corridors(
            room_min_size=kwargs.get('room_min_size', 5),
            room_max_size=kwargs.get('room_max_size', 12),
            num_rooms=kwargs.get('num_rooms', 15),
            corridor_width=kwargs.get('corridor_width', 2)
        )
        
        combined = np.minimum(ca_grid, room_grid)
        combined = self.smooth_edges(combined)
        combined = self.apply_morphology(combined, 'close', iterations=1)
        
        return combined

    def find_connected_regions(self, grid):
        visited = np.zeros_like(grid, dtype=bool)
        regions = []
        
        for y in range(self.height):
            for x in range(self.width):
                if grid[y, x] == 0 and not visited[y, x]:
                    region = self._flood_fill(grid, x, y, visited)
                    regions.append(region)
        
        return regions
    
    def _flood_fill(self, grid, start_x, start_y, visited):
        region = []
        stack = [(start_x, start_y)]
        visited[start_y, start_x] = True
        
        while stack:
            x, y = stack.pop()
            region.append((x, y))
            
            for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                nx, ny = x + dx, y + dy
                if (0 <= nx < self.width and 0 <= ny < self.height 
                    and grid[ny, nx] == 0 and not visited[ny, nx]):
                    visited[ny, nx] = True
                    stack.append((nx, ny))
        
        return region
    
    def get_region_centers(self, regions):
        centers = []
        for region in regions:
            if not region:
                continue
            xs = [p[0] for p in region]
            ys = [p[1] for p in region]
            center_x = int(np.mean(xs))
            center_y = int(np.mean(ys))
            centers.append((center_x, center_y, len(region)))
        return centers
    
    def connect_regions(self, grid, regions, corridor_width=2):
        if len(regions) <= 1:
            return grid
        
        centers = self.get_region_centers(regions)
        centers.sort(key=lambda c: c[2], reverse=True)
        
        main_center = centers[0]
        
        for i in range(1, len(centers)):
            target_center = centers[i]
            start = (main_center[0], main_center[1])
            end = (target_center[0], target_center[1])
            
            self._carve_corridor(grid, start, end, corridor_width)
        
        return grid
    
    def remove_small_regions(self, grid, regions, min_size=20):
        for region in regions:
            if len(region) < min_size:
                for x, y in region:
                    grid[y, x] = 1
        return grid
    
    def ensure_connectivity(self, grid, min_region_size=20, corridor_width=2):
        regions = self.find_connected_regions(grid)
        
        if len(regions) <= 1:
            return grid
        
        grid = self.remove_small_regions(grid, regions, min_region_size)
        
        regions = self.find_connected_regions(grid)
        
        if len(regions) <= 1:
            return grid
        
        grid = self.connect_regions(grid, regions, corridor_width)
        
        regions = self.find_connected_regions(grid)
        if len(regions) > 1:
            centers = self.get_region_centers(regions)
            for i in range(1, len(centers)):
                start = (centers[0][0], centers[0][1])
                end = (centers[i][0], centers[i][1])
                self._carve_corridor(grid, start, end, corridor_width)
        
        return grid

    def generate(self, method='hybrid', ensure_connected=True, min_region_size=20, connect_corridor_width=2, **kwargs):
        if method == 'cellular':
            grid = self.generate_cellular_automaton(**kwargs)
        elif method == 'rooms':
            grid = self.generate_rooms_and_corridors(**kwargs)
        elif method == 'noise':
            grid = self.generate_simple_noise(**kwargs)
        elif method == 'hybrid':
            grid = self.generate_hybrid(**kwargs)
        else:
            grid = self.generate_hybrid(**kwargs)
        
        if ensure_connected:
            grid = self.ensure_connectivity(grid, min_region_size, connect_corridor_width)
        
        return {
            'width': self.width,
            'height': self.height,
            'seed': self.seed,
            'data': grid.tolist()
        }
