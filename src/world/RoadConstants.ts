/**
 * Cross-section of the motorway. d is the lateral offset from the centerline of the
 * player's carriageway (positive = left). Traffic drives on the right and overtakes on
 * the left, so lane 0 (leftmost) is the fast lane and lane 3 (rightmost) the slow lane.
 *
 *   terrain | rail | opposite carriageway | median barrier | our 4 lanes | shoulder | rail | terrain
 */
export const LANE_WIDTH = 3.6;
export const LANE_COUNT = 4;
export const LANES_HALF_WIDTH = (LANE_WIDTH * LANE_COUNT) / 2;
export const LEFT_SHOULDER = 1.2;
export const RIGHT_SHOULDER = 3.0;
/** Paved edges of our carriageway. */
export const PAVED_LEFT = LANES_HALF_WIDTH + LEFT_SHOULDER;
export const PAVED_RIGHT = -(LANES_HALF_WIDTH + RIGHT_SHOULDER);
export const PAVED_WIDTH = PAVED_LEFT - PAVED_RIGHT;

/** Concrete median barrier between the carriageways. */
export const MEDIAN_WIDTH = 0.9;
export const MEDIAN_CENTER = PAVED_LEFT + MEDIAN_WIDTH / 2;
export const MEDIAN_BASE = 0.62;

/** Opposite carriageway (mirror image of ours). */
export const OPPOSITE_INNER = PAVED_LEFT + MEDIAN_WIDTH;
export const OPPOSITE_OUTER = OPPOSITE_INNER + PAVED_WIDTH;
/** Lateral center of an oncoming lane (0 = their fast lane, next to the median). */
export const oppositeLaneCenter = (lane: number): number => OPPOSITE_INNER + LEFT_SHOULDER + LANE_WIDTH * (lane + 0.5);

/** Steel guardrails on the outer verges. */
export const RAIL_OFFSET = 0.45;
export const RAIL_RIGHT = PAVED_RIGHT - RAIL_OFFSET;
export const RAIL_FAR_LEFT = OPPOSITE_OUTER + RAIL_OFFSET;

/** Faces of the barriers the player's car can hit. */
export const BARRIER_LEFT = MEDIAN_CENTER - MEDIAN_BASE / 2;
export const BARRIER_RIGHT = RAIL_RIGHT;

/** Road texture repeat length along the road (dash + gap). */
export const MARKING_PERIOD = 12;
/** Length of one recycled world chunk (a multiple of the marking period). */
export const CHUNK_LENGTH = 96;

/** Lateral center of a lane (0 = leftmost). */
export const laneCenter = (lane: number): number => LANES_HALF_WIDTH - LANE_WIDTH * (lane + 0.5);

/** Lane index nearest to a lateral offset. */
export const laneAt = (d: number): number =>
  Math.min(LANE_COUNT - 1, Math.max(0, Math.floor((LANES_HALF_WIDTH - d) / LANE_WIDTH)));
