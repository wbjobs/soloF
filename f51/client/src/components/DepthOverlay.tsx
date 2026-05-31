import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface DepthOverlayProps {
  videoElement: HTMLVideoElement | null;
  width: number;
  height: number;
  depthIntensity?: number;
  showWireframe?: boolean;
}

export function DepthOverlay({
  videoElement,
  width,
  height,
  depthIntensity = 0.5,
  showWireframe = false,
}: DepthOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const animationFrameRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.z = 2;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(0, 1, 1);
    scene.add(directionalLight);

    const geometry = new THREE.PlaneGeometry(3, 2, 128, 128);
    const positions = geometry.attributes.position;

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const distance = Math.sqrt(x * x + y * y);
      const depth = Math.sin(distance * 3) * 0.1 * depthIntensity;
      positions.setZ(i, depth);
    }
    geometry.computeVertexNormals();

    let material: THREE.Material;
    if (videoElement) {
      const videoTexture = new THREE.VideoTexture(videoElement);
      videoTexture.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshStandardMaterial({
        map: videoTexture,
        side: THREE.DoubleSide,
        metalness: 0.1,
        roughness: 0.8,
        wireframe: showWireframe,
      });
    } else {
      material = new THREE.MeshStandardMaterial({
        color: 0x4488ff,
        side: THREE.DoubleSide,
        wireframe: showWireframe,
      });
    }

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;

    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate);

      if (mesh) {
        mesh.rotation.y += 0.002;
        const positions = mesh.geometry.attributes.position;
        const time = Date.now() * 0.001;
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i);
          const y = positions.getY(i);
          const distance = Math.sqrt(x * x + y * y);
          const wave = Math.sin(distance * 4 + time * 2) * 0.05 * depthIntensity;
          positions.setZ(i, wave);
        }
        positions.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      renderer.dispose();
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [width, height, depthIntensity, showWireframe, videoElement]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}
