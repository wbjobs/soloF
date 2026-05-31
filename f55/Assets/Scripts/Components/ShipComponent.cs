using Unity.Entities;
using Unity.Mathematics;

public struct ShipTag : IComponentData { }

public struct Position : IComponentData
{
    public float3 Value;
}

public struct Velocity : IComponentData
{
    public float3 Value;
}

public struct Target : IComponentData
{
    public float3 Value;
}

public struct ShipSpeed : IComponentData
{
    public float MaxSpeed;
    public float TurnSpeed;
}
