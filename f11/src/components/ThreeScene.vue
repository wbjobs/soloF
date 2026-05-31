<template>
  <div class="scene-container">
    <canvas ref="canvasRef" id="three-canvas"></canvas>
    <div class="controls-hint">
      鼠标左键: 旋转 | 右键: 平移 | 滚轮: 缩放
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export type EasingType = 'linear' | 'ease' | 'bounce' | 'elastic' | 'back'

const props = defineProps<{
  matrix: number[]
  easing?: EasingType
  duration?: number
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let cube: THREE.Mesh
let animationId: number

let isAnimating = false
let animationStartTime = 0
let startMatrix = new THREE.Matrix4()
let targetMatrix = new THREE.Matrix4()

const easingFunctions: Record<EasingType, (t: number) => number> = {
  linear: (t) => t,
  ease: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  bounce: (t) => {
    const n1 = 7.5625
    const d1 = 1 / 2.75
    if (t < d1) return n1 * t * t
    if (t < 2 * d1) return n1 * (t -= 1.5 * d1) * t + 0.75
    if (t < 2.5 * d1) return n1 * (t -= 2.25 * d1) * t + 0.9375
    return n1 * (t -= 2.625 * d1) * t + 0.984375
  },
  elastic: (t) => {
    const c4 = (2 * Math.PI) / 3
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
  },
  back: (t) => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return c3 * t * t * t - c1 * t * t
  }
}

function lerpMatrix(from: THREE.Matrix4, to: THREE.Matrix4, t: number): THREE.Matrix4 {
  const fromElements = from.elements
  const toElements = to.elements
  const result = new THREE.Matrix4()
  
  for (let i = 0; i < 16; i++) {
    result.elements[i] = fromElements[i] + (toElements[i] - fromElements[i]) * t
  }
  
  return result
}

function updateAnimation() {
  if (!isAnimating || !cube) return
  
  const now = performance.now()
  const elapsed = (now - animationStartTime) / 1000
  const duration = props.duration || 0.5
  const progress = Math.min(elapsed / duration, 1)
  
  const easingType = props.easing || 'ease'
  const easedProgress = easingFunctions[easingType](progress)
  
  const interpolatedMatrix = lerpMatrix(startMatrix, targetMatrix, easedProgress)
  
  cube.matrix.identity()
  cube.applyMatrix4(interpolatedMatrix)
  
  if (progress >= 1) {
    isAnimating = false
  }
}

const initScene = () => {
  if (!canvasRef.value) return

  try {
    scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a1a)

    camera = new THREE.PerspectiveCamera(
      75,
      canvasRef.value.clientWidth / canvasRef.value.clientHeight,
      0.1,
      1000
    )
    camera.position.z = 5

    renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.value,
      antialias: true,
      failIfMajorPerformanceCaveat: false
    })
    renderer.setSize(canvasRef.value.clientWidth, canvasRef.value.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambientLight)

    const directionalLight1 = new THREE.DirectionalLight(0x4facfe, 1)
    directionalLight1.position.set(5, 5, 5)
    scene.add(directionalLight1)

    const directionalLight2 = new THREE.DirectionalLight(0x00f2fe, 0.5)
    directionalLight2.position.set(-5, -5, 5)
    scene.add(directionalLight2)

    const geometry = new THREE.BoxGeometry(2, 2, 2)
    const material = new THREE.MeshPhongMaterial({
      color: 0x4facfe,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    })
    cube = new THREE.Mesh(geometry, material)
    cube.matrixAutoUpdate = false
    scene.add(cube)

    const edges = new THREE.EdgesGeometry(geometry)
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
    const wireframe = new THREE.LineSegments(edges, lineMaterial)
    cube.add(wireframe)

    const axesHelper = new THREE.AxesHelper(3)
    scene.add(axesHelper)

    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222)
    scene.add(gridHelper)

    animate()

    window.addEventListener('resize', handleResize)
  } catch (e) {
    console.error('初始化Three.js场景失败:', e)
  }
}

const handleResize = () => {
  if (!canvasRef.value || !camera || !renderer) return
  
  try {
    camera.aspect = canvasRef.value.clientWidth / canvasRef.value.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(canvasRef.value.clientWidth, canvasRef.value.clientHeight)
  } catch (e) {
    console.error('处理窗口大小变化失败:', e)
  }
}

const animate = () => {
  animationId = requestAnimationFrame(animate)
  
  try {
    updateAnimation()
    if (controls) controls.update()
    if (renderer && scene && camera) {
      renderer.render(scene, camera)
    }
  } catch (e) {
    console.error('渲染失败:', e)
  }
}

const startMatrixAnimation = (newMatrixArray: number[]) => {
  if (!cube || newMatrixArray.length !== 16) return
  
  const hasInvalidValue = newMatrixArray.some(v => isNaN(v) || !isFinite(v))
  if (hasInvalidValue) {
    console.warn('矩阵包含无效值，跳过变换')
    return
  }
  
  startMatrix.copy(cube.matrix)
  targetMatrix.set(...newMatrixArray)
  animationStartTime = performance.now()
  isAnimating = true
}

const setMatrixInstant = (matrixArray: number[]) => {
  if (!cube || matrixArray.length !== 16) return
  
  const hasInvalidValue = matrixArray.some(v => isNaN(v) || !isFinite(v))
  if (hasInvalidValue) {
    console.warn('矩阵包含无效值，跳过变换')
    return
  }
  
  isAnimating = false
  cube.matrix.set(...matrixArray)
}

onMounted(() => {
  initScene()
})

onUnmounted(() => {
  try {
    cancelAnimationFrame(animationId)
    window.removeEventListener('resize', handleResize)
    if (renderer) {
      renderer.dispose()
    }
  } catch (e) {
    console.error('清理资源失败:', e)
  }
})

watch(() => props.matrix, (newMatrix) => {
  if (newMatrix && newMatrix.length === 16) {
    if (props.duration && props.duration > 0) {
      startMatrixAnimation(newMatrix)
    } else {
      setMatrixInstant(newMatrix)
    }
  }
}, { deep: true, immediate: true })
</script>
