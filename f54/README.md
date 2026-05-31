# HeatSimulation2D - 二维热传导仿真核心库

## 项目简介

一个使用C++编写的二维热传导仿真库，基于有限元方法（FEM），支持Gmsh网格读取、隐式欧拉时间步进求解，并可导出VTK格式结果用于ParaView可视化。

## 功能特性

- **网格读取**：支持读取Gmsh v2格式的`.msh`文件，解析三角形网格
- **求解器**：使用隐式欧拉法求解热方程 ∂u/∂t - α∇²u = f
- **矩阵运算**：使用Eigen库处理稀疏矩阵，高效求解线性系统
- **结果输出**：导出为VTK Legacy格式，支持ParaView可视化

## 依赖要求

- C++17 或更高版本
- CMake 3.15 或更高版本
- Eigen 3.3 或更高版本

## 编译步骤

```bash
mkdir build && cd build
cmake ..
cmake --build .
```

## 使用示例

```cpp
#include "HeatSimulation2D/HeatSimulation2D.h"

int main() {
    // 1. 读取网格
    auto mesh = HeatSimulation2D::GmshReader::read("mesh.msh");

    // 2. 配置求解器
    HeatSimulation2D::HeatSolver::Config config;
    config.alpha = 1.0;      // 热扩散系数
    config.dt = 0.01;        // 时间步长
    config.tEnd = 0.1;       // 终止时间

    HeatSimulation2D::HeatSolver solver(mesh, config);

    // 3. 设置初始条件
    auto u0 = HeatSimulation2D::Vector::Zero(mesh.nodes.size());
    solver.setInitialCondition(u0);

    // 4. 设置源项
    solver.setSourceTerm([](double x, double y) {
        double r = std::sqrt(x*x + y*y);
        return (r < 0.2) ? 10.0 : 0.0;
    });

    // 5. 设置边界条件（Dirichlet）
    std::vector<HeatSimulation2D::Index> boundaryNodes = {...};
    auto boundaryValues = HeatSimulation2D::Vector::Zero(boundaryNodes.size());
    solver.setDirichletBC(boundaryNodes, boundaryValues);

    // 6. 求解
    solver.solve();

    // 7. 输出结果
    HeatSimulation2D::VTKWriter::write("result.vtk", mesh, solver.getSolution());

    return 0;
}
```

## 运行示例程序

```bash
./HeatSimulation2D_example path/to/your/mesh.msh
```

## 项目结构

```
HeatSimulation2D/
├── include/HeatSimulation2D/
│   ├── Types.h              # 类型定义
│   ├── GmshReader.h         # Gmsh网格读取器
│   ├── HeatSolver.h         # 热方程求解器
│   ├── VTKWriter.h          # VTK输出器
│   ├── MeshRefiner.h        # 自适应网格细化器
│   ├── SolutionProjector.h  # 解的投影工具
│   └── HeatSimulation2D.h   # 总头文件
├── src/
│   ├── GmshReader.cpp
│   ├── HeatSolver.cpp
│   ├── VTKWriter.cpp
│   ├── MeshRefiner.cpp
│   └── SolutionProjector.cpp
├── examples/
│   ├── main.cpp             # 普通仿真示例
│   └── adaptive_main.cpp    # 自适应网格细化示例
├── CMakeLists.txt
├── test_square.msh          # 测试网格文件
└── README.md
```

## 数学原理

求解的热方程：
∂u/∂t = α∇²u + f

使用有限元方法离散化，得到半离散形式：
M du/dt + K u = F

其中：
- M 是质量矩阵
- K 是刚度矩阵
- F 是载荷向量

使用隐式欧拉法进行时间离散：
(M + αΔt K) u^{n+1} = M u^n + Δt F

## 许可证

MIT License
