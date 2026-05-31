using Unity.Entities;
using Unity.Collections;
using System.Diagnostics;

public partial struct StatsSystem : ISystem
{
    private NativeArray<float> _latencySamples;
    private int _sampleIndex;
    private Stopwatch _stopwatch;

    public void OnCreate(ref SystemState state)
    {
        state.RequireForUpdate<StatsConfig>();
        _latencySamples = new NativeArray<float>(60, Allocator.Persistent);
        _sampleIndex = 0;
        _stopwatch = new Stopwatch();
    }

    public void OnUpdate(ref SystemState state)
    {
        _stopwatch.Restart();

        var shipQuery = SystemAPI.QueryBuilder().WithAll<ShipTag>().Build();
        var shipCount = shipQuery.CalculateEntityCount();

        state.Dependency.Complete();
        _stopwatch.Stop();

        var currentLatency = (float)_stopwatch.Elapsed.TotalMilliseconds;
        _latencySamples[_sampleIndex] = currentLatency;
        _sampleIndex = (_sampleIndex + 1) % _latencySamples.Length;

        float total = 0f;
        for (int i = 0; i < _latencySamples.Length; i++)
        {
            total += _latencySamples[i];
        }
        var averageLatency = total / _latencySamples.Length;

        if (!SystemAPI.TryGetSingleton<ShipStats>(out var stats))
        {
            var statsEntity = state.EntityManager.CreateEntity();
            state.EntityManager.AddComponentData(statsEntity, new ShipStats
            {
                ActiveShipCount = shipCount,
                AverageLatencyMs = averageLatency,
                FrameTime = currentLatency
            });
        }
        else
        {
            stats.ActiveShipCount = shipCount;
            stats.AverageLatencyMs = averageLatency;
            stats.FrameTime = currentLatency;
            SystemAPI.SetSingleton(stats);
        }
    }

    public void OnDestroy(ref SystemState state)
    {
        if (_latencySamples.IsCreated)
        {
            _latencySamples.Dispose();
        }
    }
}
