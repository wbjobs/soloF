using Unity.Entities;
using Unity.Mathematics;
using Unity.Rendering;
using Unity.Transforms;
using UnityEngine;

public struct BoidsConfig : IComponentData
{
    public float AlignmentWeight;
    public float CohesionWeight;
    public float SeparationWeight;
    public float TargetWeight;
    public float ObstacleWeight;
    public float GravityWeight;
    public float PerceptionRadius;
    public float SeparationRadius;
    public float ObstacleAvoidanceRadius;
    public float MaxSteerForce;
    public float GravitationalConstant;
}

public partial struct MovementSystem : ISystem
{
    public void OnCreate(ref SystemState state)
    {
        state.RequireForUpdate<BoidsConfig>();
    }

    public void OnUpdate(ref SystemState state)
    {
        var boidsConfig = SystemAPI.GetSingleton<BoidsConfig>();
        var deltaTime = SystemAPI.Time.DeltaTime;

        var shipPositions = SystemAPI.QueryBuilder().WithAll<ShipTag, Position>().Build().ToComponentDataArray<Position>(Unity.Collections.Allocator.TempJob);
        var shipVelocities = SystemAPI.QueryBuilder().WithAll<ShipTag, Velocity>().Build().ToComponentDataArray<Velocity>(Unity.Collections.Allocator.TempJob);
        var beaconPositions = SystemAPI.QueryBuilder().WithAll<BeaconTag, Position, BeaconRadius>().Build();

        var beaconPosArray = beaconPositions.ToComponentDataArray<Position>(Unity.Collections.Allocator.TempJob);
        var beaconRadiusArray = beaconPositions.ToComponentDataArray<BeaconRadius>(Unity.Collections.Allocator.TempJob);

        var gravityWells = SystemAPI.QueryBuilder().WithAll<GravityWellTag, Position, GravityMass, GravityInfluenceRadius>().Build();
        var gravityPosArray = gravityWells.ToComponentDataArray<Position>(Unity.Collections.Allocator.TempJob);
        var gravityMassArray = gravityWells.ToComponentDataArray<GravityMass>(Unity.Collections.Allocator.TempJob);
        var gravityRadiusArray = gravityWells.ToComponentDataArray<GravityInfluenceRadius>(Unity.Collections.Allocator.TempJob);

        var job = new MovementJob
        {
            DeltaTime = deltaTime,
            Config = boidsConfig,
            ShipPositions = shipPositions,
            ShipVelocities = shipVelocities,
            BeaconPositions = beaconPosArray,
            BeaconRadii = beaconRadiusArray,
            GravityWellPositions = gravityPosArray,
            GravityWellMasses = gravityMassArray,
            GravityWellRadii = gravityRadiusArray
        };

        job.ScheduleParallel();
        state.Dependency.Complete();

        shipPositions.Dispose();
        shipVelocities.Dispose();
        beaconPosArray.Dispose();
        beaconRadiusArray.Dispose();
        gravityPosArray.Dispose();
        gravityMassArray.Dispose();
        gravityRadiusArray.Dispose();

        new TransformUpdateJob().ScheduleParallel();
    }
}

[WithAll(typeof(ShipTag))]
public partial struct MovementJob : IJobEntity
{
    public float DeltaTime;
    public BoidsConfig Config;
    public Unity.Collections.NativeArray<Position> ShipPositions;
    public Unity.Collections.NativeArray<Velocity> ShipVelocities;
    public Unity.Collections.NativeArray<Position> BeaconPositions;
    public Unity.Collections.NativeArray<BeaconRadius> BeaconRadii;
    public Unity.Collections.NativeArray<Position> GravityWellPositions;
    public Unity.Collections.NativeArray<GravityMass> GravityWellMasses;
    public Unity.Collections.NativeArray<GravityInfluenceRadius> GravityWellRadii;

    public void Execute(ref Position position, ref Velocity velocity, ref Target target, ref ShipSpeed speed, ref LocalTransform transform)
    {
        var currentPos = position.Value;
        var currentVel = velocity.Value;

        var moveDistance = math.length(currentVel) * DeltaTime;
        var minCollisionRadius = 2f;
        var maxStepDistance = minCollisionRadius * 0.5f;
        var numSubSteps = (int)math.ceil(moveDistance / maxStepDistance);
        numSubSteps = math.max(1, math.min(numSubSteps, 10));
        var subDeltaTime = DeltaTime / numSubSteps;

        for (int step = 0; step < numSubSteps; step++)
        {
            float3 alignment = float3.zero;
            float3 cohesion = float3.zero;
            float3 separation = float3.zero;
            float3 obstacleAvoidance = float3.zero;
            float3 gravityForce = float3.zero;
            int neighborCount = 0;
            int separationCount = 0;

            for (int i = 0; i < ShipPositions.Length; i++)
            {
                var otherPos = ShipPositions[i].Value;
                var distSq = math.distancesq(currentPos, otherPos);

                if (distSq < Config.PerceptionRadius * Config.PerceptionRadius && distSq > 0.01f)
                {
                    alignment += ShipVelocities[i].Value;
                    cohesion += otherPos;
                    neighborCount++;

                    if (distSq < Config.SeparationRadius * Config.SeparationRadius)
                    {
                        var diff = currentPos - otherPos;
                        separation += diff / distSq;
                        separationCount++;
                    }
                }
            }

            for (int i = 0; i < BeaconPositions.Length; i++)
            {
                var beaconPos = BeaconPositions[i].Value;
                var beaconRadius = BeaconRadii[i].Value;
                var avoidDist = beaconRadius + Config.ObstacleAvoidanceRadius;

                var sweepHit = SweepSphereAgainstSphere(
                    currentPos, currentVel, subDeltaTime,
                    beaconPos, avoidDist);

                if (sweepHit.HasValue)
                {
                    var hitPoint = sweepHit.Value.HitPoint;
                    var hitNormal = math.normalize(hitPoint - beaconPos);
                    var avoidForce = hitNormal * (1f / (sweepHit.Value.Time + 0.01f));
                    obstacleAvoidance += avoidForce;

                    var distToBeacon = math.distance(currentPos, beaconPos);
                    if (distToBeacon < avoidDist)
                    {
                        var diff = currentPos - beaconPos;
                        obstacleAvoidance += diff / (distToBeacon * distToBeacon) * 5f;
                    }
                }
                else
                {
                    var dist = math.distance(currentPos, beaconPos);
                    if (dist < avoidDist * 2f)
                    {
                        var diff = currentPos - beaconPos;
                        obstacleAvoidance += diff / (dist * dist);
                    }
                }
            }

            for (int i = 0; i < GravityWellPositions.Length; i++)
            {
                var wellPos = GravityWellPositions[i].Value;
                var wellMass = GravityWellMasses[i].Value;
                var wellRadius = GravityWellRadii[i].Value;

                var toWell = wellPos - currentPos;
                var dist = math.length(toWell);

                if (dist < wellRadius && dist > 1f)
                {
                    var distSq = dist * dist;
                    var gravityStrength = Config.GravitationalConstant * wellMass / distSq;
                    var gravityDir = math.normalize(toWell);
                    gravityForce += gravityDir * gravityStrength;
                }
            }

            if (neighborCount > 0)
            {
                alignment /= neighborCount;
                alignment = Normalize(alignment) * speed.MaxSpeed;
                alignment -= currentVel;
                alignment = Limit(alignment, Config.MaxSteerForce);

                cohesion /= neighborCount;
                cohesion = Seek(cohesion, currentPos, currentVel, speed.MaxSpeed);

                if (separationCount > 0)
                {
                    separation /= separationCount;
                    separation = Normalize(separation) * speed.MaxSpeed;
                    separation -= currentVel;
                    separation = Limit(separation, Config.MaxSteerForce);
                }
            }

            var targetSeek = Seek(target.Value, currentPos, currentVel, speed.MaxSpeed);

            var steering =
                alignment * Config.AlignmentWeight +
                cohesion * Config.CohesionWeight +
                separation * Config.SeparationWeight +
                targetSeek * Config.TargetWeight +
                obstacleAvoidance * Config.ObstacleWeight +
                gravityForce * Config.GravityWeight;

            currentVel += steering * subDeltaTime;
            currentVel = Limit(currentVel, speed.MaxSpeed);

            var proposedPos = currentPos + currentVel * subDeltaTime;

            for (int i = 0; i < BeaconPositions.Length; i++)
            {
                var beaconPos = BeaconPositions[i].Value;
                var beaconRadius = BeaconRadii[i].Value;
                var dist = math.distance(proposedPos, beaconPos);
                var minDist = beaconRadius + 0.5f;

                if (dist < minDist)
                {
                    var pushDir = math.normalize(proposedPos - beaconPos);
                    proposedPos = beaconPos + pushDir * minDist;
                    var velDot = math.dot(currentVel, pushDir);
                    if (velDot < 0)
                    {
                        currentVel -= pushDir * velDot * 1.5f;
                    }
                }
            }

            for (int i = 0; i < GravityWellPositions.Length; i++)
            {
                var wellPos = GravityWellPositions[i].Value;
                var wellRadius = GravityWellRadii[i].Value;
                var dist = math.distance(proposedPos, wellPos);
                var minDist = 2f;

                if (dist < minDist)
                {
                    var pushDir = math.normalize(proposedPos - wellPos);
                    proposedPos = wellPos + pushDir * minDist;
                    var velDot = math.dot(currentVel, pushDir);
                    if (velDot < 0)
                    {
                        currentVel -= pushDir * velDot * 0.8f;
                    }
                }
            }

            currentPos = proposedPos;

            if (math.distance(currentPos, target.Value) < 2f)
            {
                var random = new Random((uint)(currentPos.x * 1000 + currentPos.y * 100 + currentPos.z * 10 + 1));
                target.Value = new float3(
                    random.NextFloat(-50f, 50f),
                    random.NextFloat(-20f, 20f),
                    random.NextFloat(-50f, 50f)
                );
            }
        }

        position.Value = currentPos;
        velocity.Value = currentVel;

        transform.Position = currentPos;
        if (math.lengthsq(currentVel) > 0.01f)
        {
            transform.Rotation = quaternion.LookRotationSafe(math.normalize(currentVel), math.up());
        }
    }

    private SweepResult? SweepSphereAgainstSphere(float3 startPos, float3 velocity, float deltaTime, float3 sphereCenter, float sphereRadius)
    {
        var endPos = startPos + velocity * deltaTime;
        var dir = endPos - startPos;
        var dirLen = math.length(dir);

        if (dirLen < 0.001f)
        {
            var dist = math.distance(startPos, sphereCenter);
            if (dist < sphereRadius)
            {
                return new SweepResult { Time = 0f, HitPoint = startPos };
            }
            return null;
        }

        var dirNorm = dir / dirLen;
        var toCenter = sphereCenter - startPos;
        var t = math.dot(toCenter, dirNorm);
        t = math.clamp(t, 0f, dirLen);
        var closestPoint = startPos + dirNorm * t;
        var distToCenter = math.distance(closestPoint, sphereCenter);

        if (distToCenter < sphereRadius)
        {
            var penetration = sphereRadius - distToCenter;
            var hitTime = math.max(0f, (t - penetration) / dirLen);
            var hitPoint = startPos + dirNorm * (t - penetration);
            return new SweepResult { Time = hitTime, HitPoint = hitPoint };
        }

        return null;
    }

    private struct SweepResult
    {
        public float Time;
        public float3 HitPoint;
    }

    private float3 Seek(float3 targetPos, float3 currentPos, float3 currentVel, float maxSpeed)
    {
        var desired = targetPos - currentPos;
        desired = Normalize(desired) * maxSpeed;
        var steer = desired - currentVel;
        return Limit(steer, Config.MaxSteerForce);
    }

    private float3 Normalize(float3 v)
    {
        var len = math.length(v);
        return len > 0.001f ? v / len : float3.zero;
    }

    private float3 Limit(float3 v, float max)
    {
        var lenSq = math.lengthsq(v);
        if (lenSq > max * max)
        {
            return math.normalize(v) * max;
        }
        return v;
    }
}

[WithAll(typeof(ShipTag))]
public partial struct TransformUpdateJob : IJobEntity
{
    public void Execute(in Position position, in Velocity velocity, ref WorldTransform worldTransform, ref LocalTransform localTransform)
    {
        localTransform.Position = position.Value;
        if (math.lengthsq(velocity.Value) > 0.01f)
        {
            localTransform.Rotation = quaternion.LookRotationSafe(math.normalize(velocity.Value), math.up());
        }
        worldTransform.Value = localTransform.ToMatrix();
    }
}
