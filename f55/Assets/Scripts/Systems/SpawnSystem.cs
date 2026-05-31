using Unity.Entities;
using Unity.Mathematics;
using Unity.Rendering;
using UnityEngine;

public struct SpawnConfig : IComponentData
{
    public Entity ShipPrefab;
    public Entity BeaconPrefab;
    public Entity GravityWellPrefab;
    public int ShipCount;
    public float SpawnRadius;
    public float ShipMaxSpeed;
    public float ShipTurnSpeed;
}

public partial struct SpawnSystem : ISystem
{
    public void OnCreate(ref SystemState state)
    {
        state.RequireForUpdate<SpawnConfig>();
    }

    public void OnUpdate(ref SystemState state)
    {
        var config = SystemAPI.GetSingleton<SpawnConfig>();
        var ecb = new EntityCommandBuffer(Unity.Collections.Allocator.Temp);

        var random = new Random(12345);

        for (int i = 0; i < config.ShipCount; i++)
        {
            var angle = random.NextFloat(0f, math.PI * 2);
            var radius = random.NextFloat(0f, config.SpawnRadius);
            var position = new float3(
                math.cos(angle) * radius,
                random.NextFloat(-10f, 10f),
                math.sin(angle) * radius
            );

            var ship = ecb.Instantiate(config.ShipPrefab);
            ecb.SetComponent(ship, new Position { Value = position });
            ecb.SetComponent(ship, new Velocity { Value = float3.zero });
            ecb.SetComponent(ship, new Target
            {
                Value = new float3(
                    random.NextFloat(-50f, 50f),
                    random.NextFloat(-20f, 20f),
                    random.NextFloat(-50f, 50f)
                )
            });
            ecb.SetComponent(ship, new ShipSpeed
            {
                MaxSpeed = config.ShipMaxSpeed,
                TurnSpeed = config.ShipTurnSpeed
            });
            ecb.SetComponent(ship, new ShipTag());
            ecb.AddComponent<WorldTransform>(ship);
            ecb.AddComponent<LocalTransform>(ship);
        }

        var beaconPositions = new float3[]
        {
            new float3(0, 0, 0),
            new float3(30, 5, 30),
            new float3(-30, -5, -30),
            new float3(30, 0, -30),
            new float3(-30, 5, 30)
        };

        foreach (var pos in beaconPositions)
        {
            var beacon = ecb.Instantiate(config.BeaconPrefab);
            ecb.SetComponent(beacon, new Position { Value = pos });
            ecb.SetComponent(beacon, new BeaconRadius { Value = 5f });
            ecb.SetComponent(beacon, new BeaconTag());
            ecb.AddComponent<WorldTransform>(beacon);
            ecb.AddComponent<LocalTransform>(beacon);
        }

        var gravityWells = new (float3 Position, float Mass, float Radius)[]
        {
            (new float3(0, 0, 0), 5000f, 30f),
            (new float3(40, -10, 40), 3000f, 25f),
            (new float3(-40, 10, -40), 4000f, 28f),
            (new float3(50, 5, -30), 2500f, 20f),
            (new float3(-50, -5, 30), 3500f, 22f)
        };

        foreach (var well in gravityWells)
        {
            var gravityEntity = ecb.Instantiate(config.GravityWellPrefab);
            ecb.SetComponent(gravityEntity, new Position { Value = well.Position });
            ecb.SetComponent(gravityEntity, new GravityMass { Value = well.Mass });
            ecb.SetComponent(gravityEntity, new GravityInfluenceRadius { Value = well.Radius });
            ecb.SetComponent(gravityEntity, new GravityWellTag());
            ecb.AddComponent<WorldTransform>(gravityEntity);
            ecb.AddComponent<LocalTransform>(gravityEntity);
        }

        ecb.Playback(state.EntityManager);
        ecb.Dispose();

        state.Enabled = false;
    }
}
