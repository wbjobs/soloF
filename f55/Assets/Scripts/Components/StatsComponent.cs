using Unity.Entities;

public struct StatsConfig : IComponentData { }

public struct ShipStats : IComponentData
{
    public int ActiveShipCount;
    public float AverageLatencyMs;
    public float FrameTime;
}
