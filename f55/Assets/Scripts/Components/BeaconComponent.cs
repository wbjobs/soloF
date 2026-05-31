using Unity.Entities;
using Unity.Mathematics;

public struct BeaconTag : IComponentData { }

public struct BeaconRadius : IComponentData
{
    public float Value;
}
