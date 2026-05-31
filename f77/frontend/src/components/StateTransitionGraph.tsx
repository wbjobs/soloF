import React, { useMemo, useRef, useEffect, useState } from 'react';
import type { ProcessState, SyscallState } from '../types';

interface StateTransitionGraphProps {
  process: ProcessState;
}

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

interface Edge {
  id: string;
  source: string;
  target: string;
  label: string;
  count: number;
  avgDuration?: number;
}

const SYS_CALL_COLORS: Record<string, string> = {
  open: '#3B82F6',
  read: '#10B981',
  write: '#F59E0B',
  execve: '#A855F7',
};

const STATE_NODES: Node[] = [
  { id: 'idle', label: 'IDLE', x: 300, y: 50, color: '#6B7280' },
  { id: 'open_enter', label: 'OPEN Enter', x: 100, y: 150, color: SYS_CALL_COLORS.open },
  { id: 'open_exit', label: 'OPEN Exit', x: 100, y: 250, color: SYS_CALL_COLORS.open },
  { id: 'read_enter', label: 'READ Enter', x: 250, y: 150, color: SYS_CALL_COLORS.read },
  { id: 'read_exit', label: 'READ Exit', x: 250, y: 250, color: SYS_CALL_COLORS.read },
  { id: 'write_enter', label: 'WRITE Enter', x: 400, y: 150, color: SYS_CALL_COLORS.write },
  { id: 'write_exit', label: 'WRITE Exit', x: 400, y: 250, color: SYS_CALL_COLORS.write },
  { id: 'execve_enter', label: 'EXECVE Enter', x: 550, y: 150, color: SYS_CALL_COLORS.execve },
  { id: 'execve_exit', label: 'EXECVE Exit', x: 550, y: 250, color: SYS_CALL_COLORS.execve },
];

const DEBOUNCE_MS = 200;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [value, delay]);

  return debouncedValue;
}

function calculateEdges(states: SyscallState[]): Edge[] {
  const edgeCounts = new Map<string, { count: number; durations: number[] }>();

  const recentStates = states.slice(-50);
  for (let i = 0; i < recentStates.length - 1; i++) {
    const current = recentStates[i];
    const next = recentStates[i + 1];

    const sourceId = `${current.syscall}_${current.state}`;
    const targetId = `${next.syscall}_${next.state}`;
    const edgeId = `${sourceId}->${targetId}`;

    if (!edgeCounts.has(edgeId)) {
      edgeCounts.set(edgeId, { count: 0, durations: [] });
    }
    const entry = edgeCounts.get(edgeId)!;
    entry.count++;
    if (next.duration) {
      entry.durations.push(next.duration);
    }
  }

  return Array.from(edgeCounts.entries()).map(([id, data]) => {
    const [source, target] = id.split('->');
    return {
      id,
      source,
      target,
      label: `×${data.count}`,
      count: data.count,
      avgDuration: data.durations.length > 0
        ? data.durations.reduce((a, b) => a + b, 0) / data.durations.length
        : undefined,
    };
  });
}

export const StateTransitionGraph: React.FC<StateTransitionGraphProps> = React.memo(({ process }) => {
  const debouncedStates = useDebouncedValue(process.states, DEBOUNCE_MS);

  const { edges } = useMemo(() => {
    return { edges: calculateEdges(debouncedStates) };
  }, [debouncedStates]);

  const getNodePosition = (nodeId: string) => {
    const node = STATE_NODES.find(n => n.id === nodeId);
    return node || { x: 0, y: 0 };
  };

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <h3 className="text-white text-lg font-semibold mb-4">
        状态流转图 - {process.comm} (PID: {process.pid})
      </h3>
      <svg width="650" height="320" className="w-full">
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#9CA3AF" />
          </marker>
        </defs>

        {edges.map((edge) => {
          const source = getNodePosition(edge.source);
          const target = getNodePosition(edge.target);

          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist === 0) return null;

          const offsetX = (dx / dist) * 30;
          const offsetY = (dy / dist) * 25;

          const midX = (source.x + target.x) / 2;
          const midY = (source.y + target.y) / 2;

          const strokeWidth = Math.min(4, 1 + Math.log2(edge.count));

          return (
            <g key={edge.id}>
              <line
                x1={source.x + offsetX}
                y1={source.y + offsetY}
                x2={target.x - offsetX}
                y2={target.y - offsetY}
                stroke="#9CA3AF"
                strokeWidth={strokeWidth}
                markerEnd="url(#arrowhead)"
                opacity={0.8}
              />
              <text
                x={midX}
                y={midY - 5}
                textAnchor="middle"
                fill="#D1D5DB"
                fontSize="11"
              >
                {edge.label}
              </text>
              {edge.avgDuration && (
                <text
                  x={midX}
                  y={midY + 10}
                  textAnchor="middle"
                  fill="#9CA3AF"
                  fontSize="10"
                >
                  {(edge.avgDuration / 1000).toFixed(1)}μs
                </text>
              )}
            </g>
          );
        })}

        {STATE_NODES.map((node) => (
          <g key={node.id}>
            <rect
              x={node.x - 45}
              y={node.y - 18}
              width="90"
              height="36"
              rx="8"
              fill={node.color}
              opacity={0.2}
              stroke={node.color}
              strokeWidth="2"
            />
            <text
              x={node.x}
              y={node.y + 5}
              textAnchor="middle"
              fill={node.color}
              fontSize="12"
              fontWeight="bold"
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
});

StateTransitionGraph.displayName = 'StateTransitionGraph';
