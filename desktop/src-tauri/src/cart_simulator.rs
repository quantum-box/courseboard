use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CartColor {
    Yellow,
    Red,
    Blue,
    White,
}

#[derive(Debug, Clone, Serialize)]
pub struct CartUpdate {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    pub color: CartColor,
    #[serde(rename = "caddieNumber")]
    pub caddie_number: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct CartsMessage {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub ts: u128,
    pub carts: Vec<CartUpdate>,
}

/// Densely traced hole waypoints from `desktop/public/sora-map.png` (610x431).
/// Coordinate system: x in [0, 100], y in [0, ~70.65] — same units as the
/// frontend uses for placing carts on the textured plane.
///
/// Each polyline traces the cart-path centerline from tee to green with 6–11 points.
/// Adjacent holes intentionally do NOT share endpoint coordinates so carts on
/// different holes never visually collide on a "junction" point.
fn hole_paths() -> Vec<Vec<(f64, f64)>> {
    vec![
        // HOLE 1 — long south-to-north central-west fairway (badge ~33,42)
        vec![
            (32.0, 55.0),
            (32.5, 52.0),
            (33.0, 49.0),
            (33.2, 46.0),
            (33.5, 43.0),
            (33.7, 40.0),
            (34.0, 37.0),
            (34.0, 34.0),
            (34.0, 32.0),
        ],
        // HOLE 2 — slight left curl south-to-north
        vec![
            (32.0, 62.0),
            (31.8, 59.0),
            (31.5, 56.0),
            (31.2, 53.0),
            (31.0, 50.0),
            (30.5, 48.0),
            (30.0, 47.0),
        ],
        // HOLE 3 — runs east at bottom of map
        vec![
            (62.0, 75.0),
            (64.0, 73.0),
            (67.0, 71.0),
            (70.0, 69.0),
            (73.0, 67.0),
            (76.0, 65.0),
            (78.0, 64.0),
        ],
        // HOLE 4 — east edge, climbs north-east
        vec![
            (78.0, 42.0),
            (79.0, 39.0),
            (80.0, 36.0),
            (81.0, 33.0),
            (82.0, 30.0),
            (83.0, 28.0),
            (84.0, 27.0),
        ],
        // HOLE 5 — short uphill north-east, inside #4
        vec![
            (72.0, 40.0),
            (72.5, 36.0),
            (73.0, 32.0),
            (74.0, 29.0),
            (75.0, 27.0),
            (76.0, 25.0),
        ],
        // HOLE 6 — dogleg right toward eastern green
        vec![
            (62.0, 60.0),
            (63.5, 57.0),
            (65.0, 54.0),
            (67.0, 52.0),
            (69.0, 50.0),
            (71.0, 49.0),
            (73.0, 48.0),
            (74.0, 47.0),
        ],
        // HOLE 7 — slight right dogleg
        vec![
            (56.0, 55.0),
            (57.0, 52.0),
            (58.5, 49.0),
            (60.0, 47.0),
            (62.0, 45.0),
            (64.0, 43.5),
            (66.0, 42.0),
        ],
        // HOLE 8 — short, around the small pond
        vec![
            (52.0, 42.0),
            (51.5, 39.0),
            (50.5, 36.0),
            (51.0, 33.0),
            (52.0, 30.0),
        ],
        // HOLE 9 — south-to-north, slight left
        vec![
            (50.0, 67.0),
            (49.0, 64.0),
            (48.0, 61.0),
            (46.5, 58.0),
            (45.5, 55.0),
            (44.0, 53.0),
        ],
        // HOLE 10 — west edge, curls north-west
        vec![
            (20.0, 50.0),
            (18.0, 47.0),
            (15.0, 44.0),
            (12.0, 40.0),
            (10.0, 37.0),
            (9.0, 34.0),
            (8.0, 32.0),
        ],
        // HOLE 11 — long horizontal across the top
        vec![
            (5.0, 16.0),
            (7.0, 14.0),
            (10.0, 12.0),
            (13.0, 11.0),
            (16.0, 9.0),
            (19.0, 7.5),
            (22.0, 6.5),
            (25.0, 5.5),
            (28.0, 5.0),
            (30.0, 5.0),
        ],
        // HOLE 12 — long east diagonal across the top
        vec![
            (45.0, 25.0),
            (47.0, 22.0),
            (50.0, 20.0),
            (53.0, 18.0),
            (56.0, 16.0),
            (59.0, 14.0),
            (62.0, 12.0),
            (65.0, 10.5),
            (68.0, 9.5),
            (70.0, 8.5),
            (72.0, 8.0),
        ],
        // HOLE 13 — north-east climb to right-edge green
        vec![
            (62.0, 28.0),
            (64.0, 26.0),
            (66.0, 24.0),
            (68.0, 22.0),
            (70.0, 20.0),
            (72.0, 19.0),
            (74.0, 18.0),
            (76.0, 17.5),
            (78.0, 17.0),
        ],
        // HOLE 14 — east climb, distinct from #17 (no shared endpoints)
        vec![
            (40.0, 27.0),
            (42.0, 25.0),
            (44.0, 23.0),
            (46.0, 21.0),
            (48.0, 19.5),
            (50.0, 18.5),
            (52.0, 17.5),
            (54.0, 17.0),
        ],
        // HOLE 15 — short north-east toward small green
        vec![
            (32.0, 30.0),
            (33.0, 27.0),
            (33.5, 24.0),
            (34.5, 21.0),
            (35.5, 19.0),
            (36.5, 18.0),
            (38.0, 17.0),
        ],
        // HOLE 16 — north-west to upper-left green
        vec![
            (52.0, 27.0),
            (51.0, 24.0),
            (49.5, 21.0),
            (48.0, 18.0),
            (46.5, 16.0),
            (45.0, 14.5),
            (44.0, 13.0),
        ],
        // HOLE 17 — north-west to top-left corner (offset from #14 tee)
        vec![
            (43.0, 23.0),
            (41.0, 20.0),
            (39.0, 17.0),
            (37.0, 14.0),
            (35.0, 12.0),
            (33.5, 10.0),
            (32.0, 8.0),
        ],
        // HOLE 18 — long straight north on west side, back to IN COURSE
        vec![
            (22.0, 60.0),
            (22.0, 57.0),
            (22.0, 54.0),
            (21.5, 51.0),
            (21.0, 48.0),
            (20.5, 45.0),
            (20.2, 42.0),
            (20.0, 40.0),
        ],
    ]
}

struct CartRunner {
    id: &'static str,
    caddie_number: u32,
    color: CartColor,
    /// 0-indexed hole number (HOLE 1 = 0, HOLE 18 = 17).
    hole_idx: usize,
    /// Phase offset 0..1 to spread carts in time so they don't all sit at the tee.
    phase: f64,
    /// Seconds it takes to traverse the polyline tee → green once (one-way).
    travel_sec: f64,
}

fn runners() -> Vec<CartRunner> {
    // One cart per hole; cart numbers loosely modeled after the screenshot's caddie chips.
    vec![
        CartRunner {
            id: "cart-01",
            caddie_number: 82,
            color: CartColor::Yellow,
            hole_idx: 0,
            phase: 0.10,
            travel_sec: 42.0,
        },
        CartRunner {
            id: "cart-02",
            caddie_number: 95,
            color: CartColor::Yellow,
            hole_idx: 1,
            phase: 0.55,
            travel_sec: 32.0,
        },
        CartRunner {
            id: "cart-03",
            caddie_number: 101,
            color: CartColor::White,
            hole_idx: 2,
            phase: 0.20,
            travel_sec: 36.0,
        },
        CartRunner {
            id: "cart-04",
            caddie_number: 115,
            color: CartColor::Blue,
            hole_idx: 3,
            phase: 0.70,
            travel_sec: 26.0,
        },
        CartRunner {
            id: "cart-05",
            caddie_number: 46,
            color: CartColor::Yellow,
            hole_idx: 4,
            phase: 0.35,
            travel_sec: 22.0,
        },
        CartRunner {
            id: "cart-06",
            caddie_number: 108,
            color: CartColor::Blue,
            hole_idx: 5,
            phase: 0.05,
            travel_sec: 32.0,
        },
        CartRunner {
            id: "cart-07",
            caddie_number: 100,
            color: CartColor::Yellow,
            hole_idx: 6,
            phase: 0.60,
            travel_sec: 28.0,
        },
        CartRunner {
            id: "cart-08",
            caddie_number: 31,
            color: CartColor::Red,
            hole_idx: 7,
            phase: 0.45,
            travel_sec: 18.0,
        },
        CartRunner {
            id: "cart-09",
            caddie_number: 42,
            color: CartColor::Yellow,
            hole_idx: 8,
            phase: 0.80,
            travel_sec: 28.0,
        },
        CartRunner {
            id: "cart-10",
            caddie_number: 94,
            color: CartColor::White,
            hole_idx: 9,
            phase: 0.15,
            travel_sec: 32.0,
        },
        CartRunner {
            id: "cart-11",
            caddie_number: 127,
            color: CartColor::Red,
            hole_idx: 10,
            phase: 0.40,
            travel_sec: 48.0,
        },
        CartRunner {
            id: "cart-12",
            caddie_number: 92,
            color: CartColor::Yellow,
            hole_idx: 11,
            phase: 0.25,
            travel_sec: 46.0,
        },
        CartRunner {
            id: "cart-13",
            caddie_number: 84,
            color: CartColor::Blue,
            hole_idx: 12,
            phase: 0.65,
            travel_sec: 30.0,
        },
        CartRunner {
            id: "cart-14",
            caddie_number: 98,
            color: CartColor::Yellow,
            hole_idx: 13,
            phase: 0.50,
            travel_sec: 28.0,
        },
        CartRunner {
            id: "cart-15",
            caddie_number: 66,
            color: CartColor::Blue,
            hole_idx: 14,
            phase: 0.30,
            travel_sec: 24.0,
        },
        CartRunner {
            id: "cart-16",
            caddie_number: 48,
            color: CartColor::Yellow,
            hole_idx: 15,
            phase: 0.05,
            travel_sec: 26.0,
        },
        CartRunner {
            id: "cart-17",
            caddie_number: 105,
            color: CartColor::Yellow,
            hole_idx: 16,
            phase: 0.55,
            travel_sec: 26.0,
        },
        CartRunner {
            id: "cart-18",
            caddie_number: 126,
            color: CartColor::White,
            hole_idx: 17,
            phase: 0.75,
            travel_sec: 36.0,
        },
    ]
}

pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Walk a polyline at progress `t` in [0, 1], returning (x, y, heading_radians).
fn sample_polyline(points: &[(f64, f64)], t: f64) -> (f64, f64, f64) {
    if points.is_empty() {
        return (0.0, 0.0, 0.0);
    }
    if points.len() == 1 {
        return (points[0].0, points[0].1, 0.0);
    }

    let mut segs = Vec::with_capacity(points.len() - 1);
    let mut total = 0.0;
    for w in points.windows(2) {
        let dx = w[1].0 - w[0].0;
        let dy = w[1].1 - w[0].1;
        let d = (dx * dx + dy * dy).sqrt();
        segs.push(d);
        total += d;
    }
    if total == 0.0 {
        return (points[0].0, points[0].1, 0.0);
    }

    let target = t.clamp(0.0, 1.0) * total;
    let mut acc = 0.0;
    for (i, &seg) in segs.iter().enumerate() {
        if acc + seg >= target || i == segs.len() - 1 {
            let local = if seg > 0.0 { (target - acc) / seg } else { 0.0 };
            let (ax, ay) = points[i];
            let (bx, by) = points[i + 1];
            let x = ax + (bx - ax) * local;
            let y = ay + (by - ay) * local;
            let heading = (by - ay).atan2(bx - ax);
            return (x, y, heading);
        }
        acc += seg;
    }
    let (x, y) = *points.last().unwrap();
    (x, y, 0.0)
}

pub struct Simulator {
    paths: Vec<Vec<(f64, f64)>>,
    runners: Vec<CartRunner>,
    started_at: f64,
}

impl Simulator {
    pub fn new() -> Self {
        Self {
            paths: hole_paths(),
            runners: runners(),
            started_at: now_ms() as f64 / 1000.0,
        }
    }

    pub fn tick(&self) -> CartsMessage {
        let now = now_ms() as f64 / 1000.0;
        let elapsed = now - self.started_at;
        let carts: Vec<CartUpdate> = self
            .runners
            .iter()
            .map(|r| {
                let path = &self.paths[r.hole_idx];
                let full_cycle = r.travel_sec * 2.0;
                let mut local = (elapsed / full_cycle + r.phase).fract();
                if local < 0.0 {
                    local += 1.0;
                }
                // Triangular wave 0..1..0 for ping-pong motion along the polyline.
                let t = if local < 0.5 {
                    local * 2.0
                } else {
                    (1.0 - local) * 2.0
                };
                let (x, y, heading) = sample_polyline(path, t);
                let dir = if local < 0.5 {
                    heading
                } else {
                    heading + std::f64::consts::PI
                };
                CartUpdate {
                    id: r.id.to_string(),
                    x,
                    y,
                    heading: dir,
                    color: r.color,
                    caddie_number: r.caddie_number,
                }
            })
            .collect();

        CartsMessage {
            kind: "carts",
            ts: now_ms(),
            carts,
        }
    }
}
