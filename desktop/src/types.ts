export type Vec2 = [number, number]

export interface Polygon {
  points: Vec2[]
}

export interface Hole {
  number: number
  tee: Vec2
  green: Vec2
  /** Position where the hole-number badge is rendered on the map. */
  labelAt: Vec2
  fairway: Polygon
  greenShape: Polygon
  bunkers?: Polygon[]
  water?: Polygon[]
}

export type PoiKind = 'clubhouse' | 'restroom' | 'vending'

export interface Poi {
  kind: PoiKind
  at: Vec2
  label?: string
}

export interface CourseGeometry {
  /** Course coordinate bounds: [minX, minY, maxX, maxY] */
  bounds: [number, number, number, number]
  /** Outer boundary of the course (forest/ground polygon). */
  outline: Polygon
  holes: Hole[]
  /** Wooded areas between holes — drawn as darker green polygons. */
  forest: Polygon[]
  /** Tree dots (small green circles) for decorative density. */
  trees: Vec2[]
  water: Polygon[]
  poi: Poi[]
  /** Optional decorative paths (cart paths). */
  paths: Polygon[]
}

export type CartColor = 'yellow' | 'red' | 'blue' | 'white' | 'green'

export interface CartUpdate {
  id: string
  x: number
  y: number
  heading?: number
  color: CartColor
  caddieNumber?: number
}

export interface CartsMessage {
  type: 'carts'
  ts: number
  carts: CartUpdate[]
}
