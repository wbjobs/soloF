using Unity.Entities;
using Unity.Mathematics;
using Unity.Rendering;
using Unity.Transforms;
using UnityEngine;

public class GameBootstrap : MonoBehaviour
{
    public Mesh ShipMesh;
    public Material ShipMaterial;
    public Mesh BeaconMesh;
    public Material BeaconMaterial;
    public Mesh GravityWellMesh;
    public Material GravityWellMaterial;
    public int ShipCount = 100;
    public float SpawnRadius = 20f;
    public float ShipMaxSpeed = 10f;
    public float ShipTurnSpeed = 5f;

    void Start()
    {
        var world = World.DefaultGameObjectInjectionWorld;
        var entityManager = world.EntityManager;

        var shipPrefab = CreateShipPrefab(entityManager);
        var beaconPrefab = CreateBeaconPrefab(entityManager);
        var gravityWellPrefab = CreateGravityWellPrefab(entityManager);

        var configEntity = entityManager.CreateEntity();
        entityManager.AddComponentData(configEntity, new SpawnConfig
        {
            ShipPrefab = shipPrefab,
            BeaconPrefab = beaconPrefab,
            GravityWellPrefab = gravityWellPrefab,
            ShipCount = ShipCount,
            SpawnRadius = SpawnRadius,
            ShipMaxSpeed = ShipMaxSpeed,
            ShipTurnSpeed = ShipTurnSpeed
        });

        entityManager.AddComponentData(configEntity, new BoidsConfig
        {
            AlignmentWeight = 1.0f,
            CohesionWeight = 0.8f,
            SeparationWeight = 1.5f,
            TargetWeight = 1.2f,
            ObstacleWeight = 2.0f,
            GravityWeight = 3.0f,
            PerceptionRadius = 8f,
            SeparationRadius = 3f,
            ObstacleAvoidanceRadius = 5f,
            MaxSteerForce = 3f,
            GravitationalConstant = 0.1f
        });

        entityManager.AddComponentData(configEntity, new StatsConfig { });
    }

    private Entity CreateShipPrefab(EntityManager entityManager)
    {
        var prefab = entityManager.CreateEntity();
        entityManager.SetName(prefab, "ShipPrefab");

        entityManager.AddComponentData(prefab, new LocalTransform
        {
            Position = float3.zero,
            Rotation = quaternion.identity,
            Scale = 0.5f
        });

        entityManager.AddComponentData(prefab, new WorldTransform());
        entityManager.AddComponentData(prefab, new PostTransformMatrix { Value = float4x4.identity });

        var renderMesh = new RenderMeshArray(
            new[] { ShipMaterial },
            new[] { ShipMesh }
        );

        entityManager.AddComponentData(prefab, MaterialMeshInfo.FromRenderMeshArrayIndices(0, 0));
        entityManager.AddSharedComponentManaged(prefab, renderMesh);

        entityManager.AddComponent<Position>(prefab);
        entityManager.AddComponent<Velocity>(prefab);
        entityManager.AddComponent<Target>(prefab);
        entityManager.AddComponent<ShipSpeed>(prefab);
        entityManager.AddComponent<ShipTag>(prefab);

        return prefab;
    }

    private Entity CreateBeaconPrefab(EntityManager entityManager)
    {
        var prefab = entityManager.CreateEntity();
        entityManager.SetName(prefab, "BeaconPrefab");

        entityManager.AddComponentData(prefab, new LocalTransform
        {
            Position = float3.zero,
            Rotation = quaternion.identity,
            Scale = 1f
        });

        entityManager.AddComponentData(prefab, new WorldTransform());
        entityManager.AddComponentData(prefab, new PostTransformMatrix { Value = float4x4.identity });

        var renderMesh = new RenderMeshArray(
            new[] { BeaconMaterial },
            new[] { BeaconMesh }
        );

        entityManager.AddComponentData(prefab, MaterialMeshInfo.FromRenderMeshArrayIndices(0, 0));
        entityManager.AddSharedComponentManaged(prefab, renderMesh);

        entityManager.AddComponent<Position>(prefab);
        entityManager.AddComponent<BeaconRadius>(prefab);
        entityManager.AddComponent<BeaconTag>(prefab);

        return prefab;
    }

    private Entity CreateGravityWellPrefab(EntityManager entityManager)
    {
        var prefab = entityManager.CreateEntity();
        entityManager.SetName(prefab, "GravityWellPrefab");

        entityManager.AddComponentData(prefab, new LocalTransform
        {
            Position = float3.zero,
            Rotation = quaternion.identity,
            Scale = 2f
        });

        entityManager.AddComponentData(prefab, new WorldTransform());
        entityManager.AddComponentData(prefab, new PostTransformMatrix { Value = float4x4.identity });

        var renderMesh = new RenderMeshArray(
            new[] { GravityWellMaterial },
            new[] { GravityWellMesh }
        );

        entityManager.AddComponentData(prefab, MaterialMeshInfo.FromRenderMeshArrayIndices(0, 0));
        entityManager.AddSharedComponentManaged(prefab, renderMesh);

        entityManager.AddComponent<Position>(prefab);
        entityManager.AddComponent<GravityMass>(prefab);
        entityManager.AddComponent<GravityInfluenceRadius>(prefab);
        entityManager.AddComponent<GravityWellTag>(prefab);

        return prefab;
    }
}
