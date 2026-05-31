from dungeon_generator import DungeonGenerator
import numpy as np


def test_connectivity_fix():
    print("=" * 60)
    print("测试孤岛修复功能")
    print("=" * 60)
    
    generator = DungeonGenerator(width=80, height=60, seed=42)
    
    print("\n1. 生成不带连通性修复的地牢...")
    result_without = generator.generate(method='cellular', ensure_connected=False)
    grid_without = np.array(result_without['data'])
    
    regions_without = generator.find_connected_regions(grid_without)
    print(f"   连通区域数量（修复前）: {len(regions_without)}")
    for i, region in enumerate(regions_without):
        print(f"   区域 {i+1}: {len(region)} 个格子")
    
    print("\n2. 生成带连通性修复的地牢...")
    result_with = generator.generate(method='cellular', ensure_connected=True, min_region_size=20)
    grid_with = np.array(result_with['data'])
    
    regions_with = generator.find_connected_regions(grid_with)
    print(f"   连通区域数量（修复后）: {len(regions_with)}")
    for i, region in enumerate(regions_with):
        print(f"   区域 {i+1}: {len(region)} 个格子")
    
    if len(regions_with) == 1:
        print("\n✅ 成功！所有区域已连通！")
    else:
        print(f"\n⚠️  仍有 {len(regions_with)} 个区域")
    
    print("\n3. 测试混合算法的连通性...")
    result_hybrid = generator.generate(method='hybrid', ensure_connected=True, min_region_size=20)
    grid_hybrid = np.array(result_hybrid['data'])
    
    regions_hybrid = generator.find_connected_regions(grid_hybrid)
    print(f"   混合算法连通区域数量: {len(regions_hybrid)}")
    
    print("\n4. 可视化小示例 (20x20)...")
    small_gen = DungeonGenerator(width=20, height=20, seed=99)
    small_result = small_gen.generate(method='cellular', ensure_connected=False, fill_probability=0.5)
    small_grid = np.array(small_result['data'])
    
    print("\n   修复前:")
    for row in small_grid:
        print("   " + "".join(["█" if cell == 1 else "·" for cell in row]))
    
    regions = small_gen.find_connected_regions(small_grid)
    print(f"   区域数量: {len(regions)}")
    
    small_result_fixed = small_gen.generate(method='cellular', ensure_connected=True, min_region_size=5, fill_probability=0.5)
    small_grid_fixed = np.array(small_result_fixed['data'])
    
    print("\n   修复后:")
    for row in small_grid_fixed:
        print("   " + "".join(["█" if cell == 1 else "·" for cell in row]))
    
    regions_fixed = small_gen.find_connected_regions(small_grid_fixed)
    print(f"   区域数量: {len(regions_fixed)}")
    
    if len(regions_fixed) == 1:
        print("\n✅ 小示例测试通过！")
    else:
        print("\n⚠️  小示例仍有多个区域")
    
    print("\n" + "=" * 60)
    print("测试完成！")
    print("=" * 60)


if __name__ == "__main__":
    test_connectivity_fix()
