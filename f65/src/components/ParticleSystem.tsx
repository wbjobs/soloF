import { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { FrequencyData, hslToRgb, lerp } from '@/utils/audioUtils';

interface ParticleSystemProps {
  frequencyData: FrequencyData;
  sensitivity: number;
}

const PARTICLE_COUNT = 8000;

const vertexShader = `
  attribute float aSize;
  attribute float aSpeed;
  attribute float aOffset;
  attribute vec3 aBasePosition;
  attribute vec3 aColorOffset;

  uniform float uTime;
  uniform float uBass;
  uniform float uTreble;
  uniform float uHighs;
  uniform float uAverage;
  uniform float uSensitivity;

  varying float vIntensity;
  varying vec3 vColor;

  void main() {
    float t = uTime * aSpeed * 0.5;
    float wave = sin(t + aOffset * 10.0) * 0.5 + 0.5;
    float bass = uBass * uSensitivity;
    float treble = uTreble * uSensitivity;
    float highs = uHighs * uSensitivity;
    float average = uAverage * uSensitivity;

    float bassScale = 1.0 + bass * 3.0;
    float trebleEffect = treble * 2.0;

    vec3 pos = aBasePosition;
    float expansion = 1.0 + bass * 0.3;
    pos *= expansion;

    float noise = sin(t * 0.5 + aOffset * 20.0) * highs * 2.0;
    pos += normalize(pos) * noise;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float size = aSize * bassScale * (1.0 + trebleEffect * 0.5);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;

    vIntensity = average * 0.5 + wave * 0.5;
    vColor = aColorOffset;
  }
`;

const fragmentShader = `
  uniform float uTreble;
  uniform float uTime;
  uniform float uSensitivity;

  varying float vIntensity;
  varying vec3 vColor;

  void main() {
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);

    if (dist > 0.5) discard;

    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
    float glow = 1.0 / (dist * 2.0 + 0.5) * 0.5;

    vec3 color = vColor;
    float treble = uTreble * uSensitivity;
    float brightness = vIntensity * 0.6 + treble * 0.4;
    color *= brightness * (0.6 + vIntensity * 0.8);

    gl_FragColor = vec4(color * glow, alpha * (0.4 + vIntensity * 0.6));
  }
`;

export default function ParticleSystem({ frequencyData, sensitivity }: ParticleSystemProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const timeRef = useRef(0);
  const bassRef = useRef(0);
  const trebleRef = useRef(0);
  const highsRef = useRef(0);
  const averageRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 });
  const targetRotationRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const previousMouseRef = useRef({ x: 0, y: 0 });
  const cameraDistanceRef = useRef(15);
  const frequencyDataRef = useRef(frequencyData);
  const sensitivityRef = useRef(sensitivity);

  useEffect(() => {
    frequencyDataRef.current = frequencyData;
  }, [frequencyData]);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  const particleData = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const speeds = new Float32Array(PARTICLE_COUNT);
    const offsets = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 3 + Math.random() * 4;

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);

      const hue = Math.random();
      const [r, g, b] = hslToRgb(hue, 0.8, 0.5);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      sizes[i] = 0.02 + Math.random() * 0.04;
      speeds[i] = 0.5 + Math.random() * 1.5;
      offsets[i] = Math.random() * 100;
    }

    return { positions, colors, sizes, speeds, offsets };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = cameraDistanceRef.current;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(particleData.positions, 3));
    geometry.setAttribute('aBasePosition', new THREE.BufferAttribute(particleData.positions.slice(), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(particleData.colors, 3));
    geometry.setAttribute('aColorOffset', new THREE.BufferAttribute(particleData.colors.slice(), 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(particleData.sizes, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(particleData.speeds, 1));
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(particleData.offsets, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uTreble: { value: 0 },
        uHighs: { value: 0 },
        uAverage: { value: 0 },
        uSensitivity: { value: 1.5 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    materialRef.current = material;

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);
    particlesRef.current = particles;

    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: -(e.clientY / window.innerHeight) * 2 + 1,
      };

      if (isDraggingRef.current) {
        const deltaX = e.clientX - previousMouseRef.current.x;
        const deltaY = e.clientY - previousMouseRef.current.y;
        targetRotationRef.current.y += deltaX * 0.005;
        targetRotationRef.current.x += deltaY * 0.005;
        previousMouseRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      previousMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    const handleWheel = (e: WheelEvent) => {
      cameraDistanceRef.current += e.deltaY * 0.01;
      cameraDistanceRef.current = Math.max(8, Math.min(30, cameraDistanceRef.current));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('wheel', handleWheel);

    const animate = () => {
      timeRef.current += 0.016;

      const freqData = frequencyDataRef.current;
      bassRef.current = lerp(bassRef.current, freqData.bass, 0.1);
      trebleRef.current = lerp(trebleRef.current, freqData.treble, 0.1);
      highsRef.current = lerp(highsRef.current, freqData.highs, 0.1);
      averageRef.current = lerp(averageRef.current, freqData.average, 0.1);

      material.uniforms.uTime.value = timeRef.current;
      material.uniforms.uBass.value = bassRef.current;
      material.uniforms.uTreble.value = trebleRef.current;
      material.uniforms.uHighs.value = highsRef.current;
      material.uniforms.uAverage.value = averageRef.current;
      material.uniforms.uSensitivity.value = sensitivityRef.current;

      if (!isDraggingRef.current) {
        targetRotationRef.current.y += 0.002;
      }

      particles.rotation.y = lerp(
        particles.rotation.y,
        targetRotationRef.current.y,
        0.05
      );
      particles.rotation.x = lerp(
        particles.rotation.x,
        targetRotationRef.current.x,
        0.05
      );

      camera.position.z = lerp(
        camera.position.z,
        cameraDistanceRef.current,
        0.05
      );

      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      animationIdRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('wheel', handleWheel);

      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      renderer.domElement.remove();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [particleData]);

  useEffect(() => {
    if (!materialRef.current || !particlesRef.current) return;

    const colors = particlesRef.current.geometry.attributes.aColorOffset as THREE.BufferAttribute;
    const colorArray = colors.array as Float32Array;

    const treble = frequencyData.treble * sensitivity;
    const highs = frequencyData.highs * sensitivity;
    const mids = frequencyData.mids * sensitivity;
    const average = frequencyData.average * sensitivity;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const idx = i * 3;
      const baseHue = (i / PARTICLE_COUNT + treble * 0.3) % 1;
      const hue = (baseHue + highs * 0.5) % 1;
      const saturation = 0.7 + mids * 0.3;
      const lightness = 0.4 + average * 0.4;
      const [r, g, b] = hslToRgb(hue, saturation, lightness);
      colorArray[idx] = lerp(colorArray[idx], r, 0.05);
      colorArray[idx + 1] = lerp(colorArray[idx + 1], g, 0.05);
      colorArray[idx + 2] = lerp(colorArray[idx + 2], b, 0.05);
    }
    colors.needsUpdate = true;
  }, [frequencyData.treble, frequencyData.highs, frequencyData.mids, frequencyData.average, sensitivity]);

  return <div ref={containerRef} className="fixed inset-0 top-0 left-0 w-full h-full" />;
}
