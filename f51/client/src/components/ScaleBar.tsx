import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ScaleBarProps {
  container: HTMLDivElement | null;
  scaleBarLength: number;
  magnification: number;
  unit: string;
  width: number;
  height: number;
}

export function ScaleBar({
  container,
  scaleBarLength,
  magnification,
  unit,
  width,
  height,
}: ScaleBarProps) {
  const scaleBarRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: THREE.WebGLRenderer;
    barGroup: THREE.Group;
    textCanvas: HTMLCanvasElement;
    textTexture: THREE.CanvasTexture;
  } | null>(null);
  const animationFrameRef = useRef<number>(0);
  const needsRenderRef = useRef(true);

  const render = () => {
    if (!scaleBarRef.current || !needsRenderRef.current) return;
    scaleBarRef.current.renderer.render(
      scaleBarRef.current.scene,
      scaleBarRef.current.camera
    );
    needsRenderRef.current = false;
  };

  useEffect(() => {
    if (!container) return;

    const scene = new THREE.Scene();

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    camera.position.z = 1;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const barGroup = new THREE.Group();
    scene.add(barGroup);

    const barGeometry = new THREE.PlaneGeometry(1, 0.03);
    const barMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const bar = new THREE.Mesh(barGeometry, barMaterial);
    barGroup.add(bar);

    const tickMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const tickGeometry = new THREE.PlaneGeometry(0.008, 0.08);
    const leftTick = new THREE.Mesh(tickGeometry, tickMaterial);
    leftTick.position.x = -0.5;
    barGroup.add(leftTick);

    const rightTick = new THREE.Mesh(tickGeometry, tickMaterial);
    rightTick.position.x = 0.5;
    barGroup.add(rightTick);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const textTexture = new THREE.CanvasTexture(canvas);
    textTexture.needsUpdate = false;
    const textMaterial = new THREE.MeshBasicMaterial({
      map: textTexture,
      transparent: true,
    });
    const textGeometry = new THREE.PlaneGeometry(0.6, 0.15);
    const textMesh = new THREE.Mesh(textGeometry, textMaterial);
    textMesh.position.y = -0.14;
    barGroup.add(textMesh);

    const actualLength = Math.round(100 / (magnification / 100));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 48px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 6;
    ctx.fillText(`${actualLength} ${unit}`, canvas.width / 2, canvas.height / 2);

    const barWidth = Math.max(0.1, Math.min(0.8, scaleBarLength));
    bar.scale.x = barWidth;
    leftTick.position.x = -barWidth / 2;
    rightTick.position.x = barWidth / 2;

    barGroup.position.set(-0.85, -0.8, 0);

    scaleBarRef.current = { scene, camera, renderer, barGroup, textCanvas: canvas, textTexture };

    needsRenderRef.current = true;
    render();

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      barGeometry.dispose();
      barMaterial.dispose();
      tickGeometry.dispose();
      tickMaterial.dispose();
      textGeometry.dispose();
      textMaterial.dispose();
      textTexture.dispose();
      renderer.dispose();
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [container, width, height]);

  useEffect(() => {
    if (!scaleBarRef.current) return;

    const { barGroup, textCanvas, textTexture } = scaleBarRef.current;
    const bar = barGroup.children[0] as THREE.Mesh;
    const leftTick = barGroup.children[1] as THREE.Mesh;
    const rightTick = barGroup.children[2] as THREE.Mesh;

    const barWidth = Math.max(0.1, Math.min(0.8, scaleBarLength));
    bar.scale.x = barWidth;
    leftTick.position.x = -barWidth / 2;
    rightTick.position.x = barWidth / 2;

    const ctx = textCanvas.getContext('2d')!;
    const actualLength = Math.round(100 / (magnification / 100));
    ctx.clearRect(0, 0, textCanvas.width, textCanvas.height);
    ctx.font = 'bold 48px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 6;
    ctx.fillText(`${actualLength} ${unit}`, textCanvas.width / 2, textCanvas.height / 2);
    textTexture.needsUpdate = true;

    needsRenderRef.current = true;
    render();
  }, [scaleBarLength, magnification, unit]);

  return null;
}
