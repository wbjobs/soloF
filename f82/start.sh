#!/bin/bash
set -e

echo "========================================"
echo "启动 PageRank 计算服务"
echo "========================================"

MASTER_PORT=50051
HTTP_PORT=8080
ETCD_ENDPOINTS="localhost:2379"
NUM_WORKERS=3
WORKER_PORT_BASE=50052

echo ""
echo "检查 etcd 是否运行..."
if ! pgrep -x etcd > /dev/null; then
    echo "  启动 etcd..."
    etcd &
    sleep 2
    echo "  etcd 已启动"
else
    echo "  etcd 已在运行"
fi

echo ""
echo "启动 Master 节点..."
cd master
./pagerank-master \
    --grpc-port $MASTER_PORT \
    --http-port $HTTP_PORT \
    --etcd $ETCD_ENDPOINTS \
    --workers $NUM_WORKERS &
MASTER_PID=$!
cd ..

echo "  Master PID: $MASTER_PID"
sleep 1

echo ""
echo "启动 Worker 节点..."
WORKER_PIDS=()
for i in $(seq 0 $((NUM_WORKERS - 1))); do
    PORT=$((WORKER_PORT_BASE + i))
    cd worker/build
    ./worker \
        --master "localhost:$MASTER_PORT" \
        --port $PORT \
        --etcd $ETCD_ENDPOINTS &
    WORKER_PIDS+=($!)
    cd ../..
    echo "  Worker $((i + 1)) PID: ${WORKER_PIDS[$i]}"
done

echo ""
echo "启动前端开发服务器..."
cd web
npm run dev &
WEB_PID=$!
cd ..

echo ""
echo "========================================"
echo "服务启动完成！"
echo ""
echo "Master gRPC: localhost:$MASTER_PORT"
echo "Master API:  http://localhost:$HTTP_PORT"
echo "Web UI:      http://localhost:3000"
echo "Workers:     localhost:$WORKER_PORT_BASE-$((WORKER_PORT_BASE + NUM_WORKERS - 1))"
echo ""
echo "Master PID: $MASTER_PID"
echo "Worker PIDs: ${WORKER_PIDS[*]}"
echo "Web PID:    $WEB_PID"
echo ""
echo "按 Ctrl+C 停止所有服务"
echo "========================================"

trap "echo ''; echo '正在停止服务...'; kill $MASTER_PID ${WORKER_PIDS[*]} $WEB_PID 2>/dev/null; wait $MASTER_PID ${WORKER_PIDS[*]} $WEB_PID 2>/dev/null; echo '服务已停止'" EXIT

wait
