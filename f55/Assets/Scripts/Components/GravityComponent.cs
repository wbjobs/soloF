using Unity.Entities;
using Unity.Mathematics;

public struct GravityWellTag : IComponentData { }

public struct GravityMass : IComponentData
{
    public float Value;
}

public struct GravityInfluenceRadius : IComponentData
{
    public float Value;
}
