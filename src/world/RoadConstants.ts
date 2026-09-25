/**
 * Cross-section of the carriageway. d is the lateral offset from the road
 * centerline (positive = left). Traffic drives on the right and overtakes on the left,
 * so lane 0 (leftmost) is the fast lane and lane 3 (rightmost) the slow lane.
 */
export const LANE_WIDTH = 3.6;
export const LANE_COUNT = 4;
export const LANES_HALF_WIDTH = (LANE_WIDTH * LANE_COUNT) / 2;
export const LEFT_SHOULDER = 1.2;
export const RIGHT_SHOULDER = 3.0;
/** Paved edges. */
export const PAVED_LEFT = LANES_HALF_WIDTH + LEFT_SHOULDER;
export const PAVED_RIGHT = -(LANES_HALF_WIDTH + RIGHT_SHOULDER);
/** Faces of the barriers the car can hit. */
export const BARRIER_LEFT = PAVED_LEFT + 0.25;
export const BARRIER_RIGHT = PAVED_RIGHT - 0.45;
/** Road texture repeat length along the road (dash + gap). */
export const MARKING_PERIOD = 12;

/** Lateral center of a lane (0 = leftmost). */
export const laneCenter = (lane: number): number => LANES_HALF_WIDTH - LANE_WIDTH * (lane + 0.5);

/** Lane index nearest to a lateral offset. */
export const laneAt = (d: number): number =>
  Math.min(LANE_COUNT - 1, Math.max(0, Math.floor((LANES_HALF_WIDTH - d) / LANE_WIDTH)));
