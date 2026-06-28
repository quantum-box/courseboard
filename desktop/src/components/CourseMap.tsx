import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { CartColor, CartUpdate } from '../types'

const CART_COLOR_HEX: Record<CartColor, number> = {
  yellow: 0xf2c12e,
  red: 0xe05c5c,
  blue: 0x4aa3e0,
  white: 0xfafafa,
  green: 0x4ade80,
}

function makeCart(color: number, scale: number): THREE.Group {
  const group = new THREE.Group()
  group.scale.set(scale, scale, 1)
  // halo
  const haloGeom = new THREE.CircleGeometry(1.8, 28)
  const haloMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22 })
  const halo = new THREE.Mesh(haloGeom, haloMat)
  group.add(halo)
  // drop shadow
  const shadowGeom = new THREE.CircleGeometry(1.18, 28)
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
  const shadow = new THREE.Mesh(shadowGeom, shadowMat)
  shadow.position.set(0.1, -0.1, -0.005)
  group.add(shadow)
  // body
  const bodyGeom = new THREE.CircleGeometry(1.0, 28)
  const bodyMat = new THREE.MeshBasicMaterial({ color })
  const body = new THREE.Mesh(bodyGeom, bodyMat)
  body.position.z = 0.01
  group.add(body)
  // outline ring
  const ringGeom = new THREE.RingGeometry(1.0, 1.15, 32)
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x0c2a14 })
  const ring = new THREE.Mesh(ringGeom, ringMat)
  ring.position.z = 0.02
  group.add(ring)
  // highlight
  const hlGeom = new THREE.CircleGeometry(0.42, 20)
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })
  const hl = new THREE.Mesh(hlGeom, hlMat)
  hl.position.set(-0.3, 0.32, 0.03)
  group.add(hl)
  return group
}

interface CourseMapProps {
  carts: CartUpdate[]
}

const COURSE_IMAGE = '/sora-map.png'

export function CourseMap({ carts }: CourseMapProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cartLayerRef = useRef<THREE.Group | null>(null)
  const cartMeshes = useRef<Map<string, THREE.Group>>(new Map())
  // World extents — set after the texture loads so the plane matches the image aspect.
  const worldRef = useRef<{ w: number; h: number; cartScale: number }>({ w: 100, h: 100, cartScale: 1 })

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const mountEl: HTMLDivElement = mount

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0e1c12')
    sceneRef.current = scene

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    mountEl.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Cart layer above the map texture.
    const cartLayer = new THREE.Group()
    cartLayer.position.z = 0.5
    scene.add(cartLayer)
    cartLayerRef.current = cartLayer

    // Camera (sized after texture loads).
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)
    cameraRef.current = camera

    function fitCameraToWorld() {
      const w = mountEl.clientWidth
      const h = mountEl.clientHeight
      renderer.setSize(w, h, false)

      const aspect = w / h
      const { w: ww, h: wh } = worldRef.current
      const worldAspect = ww / wh
      let viewW: number
      let viewH: number
      if (aspect > worldAspect) {
        viewH = wh
        viewW = wh * aspect
      } else {
        viewW = ww
        viewH = ww / aspect
      }
      const pad = 1.04
      camera.left = (-viewW / 2) * pad
      camera.right = (viewW / 2) * pad
      camera.top = (viewH / 2) * pad
      camera.bottom = (-viewH / 2) * pad
      camera.position.set(0, 0, 5)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
    }

    // Load the course map texture.
    const loader = new THREE.TextureLoader()
    loader.load(
      COURSE_IMAGE,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        const img = texture.image as { width: number; height: number }
        // Scale the longer side to 100 world units.
        const aspect = img.width / img.height
        const ww = aspect >= 1 ? 100 : 100 * aspect
        const wh = aspect >= 1 ? 100 / aspect : 100
        // Carts authored on a 100x100 system; scale by min dimension so they look right on tall/wide maps.
        const cartScale = Math.min(ww, wh) / 60 // tune visual size
        worldRef.current = { w: ww, h: wh, cartScale }

        const planeGeom = new THREE.PlaneGeometry(ww, wh)
        const planeMat = new THREE.MeshBasicMaterial({ map: texture })
        const plane = new THREE.Mesh(planeGeom, planeMat)
        plane.position.set(0, 0, -1)
        scene.add(plane)

        // Rescale any existing cart meshes.
        for (const mesh of cartMeshes.current.values()) {
          mesh.scale.set(cartScale, cartScale, 1)
        }

        fitCameraToWorld()
      },
      undefined,
      (err) => {
        console.error('Failed to load course map texture', err)
      },
    )

    fitCameraToWorld()

    const ro = new ResizeObserver(fitCameraToWorld)
    ro.observe(mountEl)

    return () => {
      ro.disconnect()
      mountEl.removeChild(renderer.domElement)
      renderer.dispose()
      cartMeshes.current.clear()
    }
  }, [])

  // Update cart markers when carts prop changes.
  // Cart coordinates are 0..100 in both axes; we map them to world coordinates that
  // are centered around (0,0) and sized to the texture's aspect ratio.
  useEffect(() => {
    const layer = cartLayerRef.current
    const renderer = rendererRef.current
    const camera = cameraRef.current
    const scene = sceneRef.current
    if (!layer || !renderer || !camera || !scene) return

    const { w: ww, h: wh, cartScale } = worldRef.current

    const seen = new Set<string>()
    for (const cart of carts) {
      seen.add(cart.id)
      let mesh = cartMeshes.current.get(cart.id)
      if (!mesh) {
        mesh = makeCart(CART_COLOR_HEX[cart.color] ?? 0xffffff, cartScale)
        cartMeshes.current.set(cart.id, mesh)
        layer.add(mesh)
      }
      // Cart coords are authored in the image's own units: x in [0,100], y in [0, 100/aspect].
      // The world plane is centered at origin, so subtract half-extents.
      const wx = (cart.x / 100) * ww - ww / 2
      const wy = wh / 2 - (cart.y / 100) * ww
      mesh.position.set(wx, wy, 0)
    }
    for (const [id, mesh] of cartMeshes.current) {
      if (!seen.has(id)) {
        layer.remove(mesh)
        cartMeshes.current.delete(id)
      }
    }
    renderer.render(scene, camera)
  }, [carts])

  return (
    <div className="map-container" ref={mountRef} style={{ width: '100%', height: '100%' }}>
      <div className="cart-legend">
        <div className="row"><span className="swatch" style={{ background: '#f2c12e' }} /> 進行中</div>
        <div className="row"><span className="swatch" style={{ background: '#e05c5c' }} /> 遅延</div>
        <div className="row"><span className="swatch" style={{ background: '#4aa3e0' }} /> 待機</div>
      </div>
      <div className="course-badge">
        <div className="title">空沼コース</div>
        <div className="sub">SAPPORO CC · Sora Course</div>
      </div>
    </div>
  )
}
