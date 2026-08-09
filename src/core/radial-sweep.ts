import {
  DISTANCE_TIE_TOLERANCE_METERS,
  SPATIAL_TOLERANCE_METERS,
} from "./constants.js";
import type {
  BuildingDataset,
  BuildingEdge,
  Coordinate,
  PreparedBuilding,
} from "./dataset-types.js";
import type { ParameterInterval } from "./visibility-types.js";
import {
  computeVisibleIntervalsForEdge,
  isSightLineBlocked,
} from "./visibility-engine.js";

const TWO_PI = Math.PI * 2;
const ANGLE_EPSILON = 1e-12;
const PARAMETER_EPSILON = 1e-12;
// This is only a conservative trigger envelope. ArcGIS remains authoritative
// about whether the configured 1 mm tolerance makes a sight line visible.
const FALLBACK_DISTANCE_METERS = SPATIAL_TOLERANCE_METERS * 4;
const WORK_CHUNK_SIZE = 4096;

export type SweepVisibleIntervals = Map<number, Map<number, ParameterInterval[]>>;

interface SweepSegment {
  readonly id: number;
  readonly buildingInputIndex: number;
  readonly target: boolean;
  readonly edge: BuildingEdge;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly wraps: boolean;
}

interface SweepEvent {
  readonly angle: number;
  readonly kind: "start" | "end";
  readonly segment: SweepSegment;
}

interface SweepEventGroup {
  readonly angle: number;
  readonly starts: readonly SweepSegment[];
  readonly ends: readonly SweepSegment[];
}

interface OriginBlocker {
  readonly building: PreparedBuilding;
}

interface EdgeLocation {
  readonly building: PreparedBuilding;
  readonly edge: BuildingEdge;
}

interface SweepInput {
  readonly dataset: BuildingDataset;
  readonly antenna: Coordinate;
  readonly targetBuildingIndexes: ReadonlySet<number>;
  readonly signal?: AbortSignal;
}

export function computeRadialSweepVisibility(
  dataset: BuildingDataset,
  antenna: Coordinate,
  targetBuildingIndexes: ReadonlySet<number>,
  signal?: AbortSignal,
): SweepVisibleIntervals {
  const iterator = radialSweepSteps({ dataset, antenna, targetBuildingIndexes, signal });
  while (true) {
    const step = iterator.next();
    if (step.done) return step.value;
    throwIfAborted(signal);
  }
}

export async function computeRadialSweepVisibilityAsync(
  dataset: BuildingDataset,
  antenna: Coordinate,
  targetBuildingIndexes: ReadonlySet<number>,
  signal?: AbortSignal,
): Promise<SweepVisibleIntervals> {
  const iterator = radialSweepSteps({ dataset, antenna, targetBuildingIndexes, signal });
  while (true) {
    const step = iterator.next();
    if (step.done) return step.value;
    await yieldToEventLoop();
    throwIfAborted(signal);
  }
}

function* radialSweepSteps(input: SweepInput): Generator<void, SweepVisibleIntervals> {
  const { dataset, antenna, targetBuildingIndexes, signal } = input;
  const visible: SweepVisibleIntervals = new Map();
  const fallbackEdges = new Map<number, EdgeLocation>();
  const segments: SweepSegment[] = [];
  const events: SweepEvent[] = [];
  let globalEdgeId = 0;
  let workCount = 0;

  for (const building of dataset.buildings) {
    const target = targetBuildingIndexes.has(building.inputIndex);
    const targetNearAntenna = target && building.edges.some((edge) =>
      pointToSegmentDistance(antenna, edge.start, edge.end) <= SPATIAL_TOLERANCE_METERS);
    for (const edge of building.edges) {
      throwIfAborted(signal);
      const id = globalEdgeId;
      globalEdgeId += 1;
      if (targetNearAntenna) fallbackEdges.set(id, { building, edge });
      const firstVector = subtract(edge.start, antenna);
      const secondVector = subtract(edge.end, antenna);
      const firstDistance = magnitude(firstVector);
      const secondDistance = magnitude(secondVector);
      const closestDistance = pointToSegmentDistance(antenna, edge.start, edge.end);

      if (
        closestDistance <= DISTANCE_TIE_TOLERANCE_METERS
        || firstDistance <= DISTANCE_TIE_TOLERANCE_METERS
        || secondDistance <= DISTANCE_TIE_TOLERANCE_METERS
        || isExactlyRadial(firstVector, secondVector)
      ) {
        // A radial edge has zero angular measure and cannot participate in an
        // open sweep slab. Claimed radial/incident edges use the reference
        // ArcGIS interval classifier so their collinear visibility is explicit.
        if (target) fallbackEdges.set(id, { building, edge });
        continue;
      }

      const firstAngle = normalizeAngle(Math.atan2(firstVector[1], firstVector[0]));
      const secondAngle = normalizeAngle(Math.atan2(secondVector[1], secondVector[0]));
      const forwardSpan = normalizeAngle(secondAngle - firstAngle);
      const startAngle = forwardSpan <= Math.PI ? firstAngle : secondAngle;
      const endAngle = forwardSpan <= Math.PI ? secondAngle : firstAngle;
      const span = forwardSpan <= Math.PI ? forwardSpan : TWO_PI - forwardSpan;

      if (span <= ANGLE_EPSILON) {
        if (target) fallbackEdges.set(id, { building, edge });
        continue;
      }

      const segment: SweepSegment = {
        id,
        buildingInputIndex: building.inputIndex,
        target,
        edge,
        startAngle,
        endAngle,
        wraps: startAngle > endAngle,
      };
      segments.push(segment);
      events.push({ angle: startAngle, kind: "start", segment });
      events.push({ angle: endAngle, kind: "end", segment });

      if (
        target
        && (
          closestDistance <= SPATIAL_TOLERANCE_METERS
          || span * Math.min(firstDistance, secondDistance) <= FALLBACK_DISTANCE_METERS
        )
      ) {
        fallbackEdges.set(id, { building, edge });
      }

      workCount += 1;
      if (workCount % WORK_CHUNK_SIZE === 0) yield;
    }
  }

  events.sort((left, right) => left.angle - right.angle || eventKindOrder(left) - eventKindOrder(right)
    || left.segment.id - right.segment.id);
  const groups = groupEvents(events);
  if (groups.length > 0) {
    const firstAngle = groups[0]?.angle ?? 0;
    const initialProbe = firstAngle > ANGLE_EPSILON ? firstAngle / 2 : TWO_PI - ANGLE_EPSILON;
    const active = new ActiveSegmentTreap(antenna, initialProbe);
    for (const segment of segments) {
      if (segment.wraps) active.insert(segment);
    }
    const originBlockers = findOriginBlockers(dataset, antenna);
    for (const [groupIndex, group] of groups.entries()) {
      throwIfAborted(signal);
      for (const segment of group.ends) active.remove(segment.id);
      const nextGroup = groups[(groupIndex + 1) % groups.length];
      if (nextGroup === undefined) break;
      const nextAngle = groupIndex + 1 < groups.length
        ? nextGroup.angle
        : nextGroup.angle + TWO_PI;
      const gap = nextAngle - group.angle;
      if (gap <= ANGLE_EPSILON) continue;
      const probeAngle = group.angle + gap / 2;
      active.setAngle(probeAngle);
      for (const segment of group.starts) active.insert(segment);

      const nearest = active.minimum();
      if (nearest !== undefined && active.hasTarget()) {
        const toleranceSensitive = isToleranceSensitiveSlab(
          active,
          antenna,
          probeAngle,
        );
        if (!toleranceSensitive) {
          recordSlabCandidate(
            dataset,
            visible,
            fallbackEdges,
            nearest,
            antenna,
            group.angle,
            nextAngle,
            probeAngle,
            originBlockers,
            targetBuildingIndexes,
          );
        } else {
          recordToleranceSlabCandidates(
            dataset,
            visible,
            fallbackEdges,
            active,
            antenna,
            group.angle,
            nextAngle,
            probeAngle,
            originBlockers,
            targetBuildingIndexes,
          );
        }

      }

      workCount += 1;
      if (workCount % WORK_CHUNK_SIZE === 0) yield;
    }
  }

  for (const { building, edge } of fallbackEdges.values()) {
    throwIfAborted(signal);
    if (targetBuildingIndexes.has(building.inputIndex)) {
      const intervals = computeVisibleIntervalsForEdge(
        dataset,
        edge,
        antenna,
        signal,
      );
      setVisibleIntervals(
        visible,
        building.inputIndex,
        edge.edgeIndex,
        intervals,
      );
    }
    workCount += 1;
    if (workCount % WORK_CHUNK_SIZE === 0) yield;
  }

  return visible;
}

function groupEvents(events: readonly SweepEvent[]): SweepEventGroup[] {
  const groups: Array<{ angle: number; starts: SweepSegment[]; ends: SweepSegment[] }> = [];

  for (const event of events) {
    const previous = groups.at(-1);
    const group = previous !== undefined && Math.abs(previous.angle - event.angle) <= ANGLE_EPSILON
      ? previous
      : { angle: event.angle, starts: [], ends: [] };
    if (group !== previous) groups.push(group);
    if (event.kind === "start") group.starts.push(event.segment);
    else group.ends.push(event.segment);
  }

  return groups;
}

function findOriginBlockers(dataset: BuildingDataset, antenna: Coordinate): OriginBlocker[] {
  const [x, y] = antenna;
  const items = dataset.boundaryIndex.search({
    minX: x - SPATIAL_TOLERANCE_METERS,
    minY: y - SPATIAL_TOLERANCE_METERS,
    maxX: x + SPATIAL_TOLERANCE_METERS,
    maxY: y + SPATIAL_TOLERANCE_METERS,
  });
  const buildingIndexes = new Set<number>();

  for (const item of items) {
    const building = dataset.buildings[item.buildingInputIndex];
    const edge = building?.edges[item.edgeIndex];
    if (
      building !== undefined
      && edge !== undefined
      && pointToSegmentDistance(antenna, edge.start, edge.end) <= DISTANCE_TIE_TOLERANCE_METERS
    ) {
      buildingIndexes.add(building.inputIndex);
    }
  }

  return [...buildingIndexes]
    .map((index) => dataset.buildings[index])
    .filter((building): building is PreparedBuilding => building !== undefined)
    .map((building) => ({ building }));
}

function isBlockedAtOrigin(
  antenna: Coordinate,
  angle: number,
  blockers: readonly OriginBlocker[],
): boolean {
  if (blockers.length === 0) return false;
  const probeDistance = SPATIAL_TOLERANCE_METERS / 10;
  const probe: Coordinate = [
    antenna[0] + Math.cos(angle) * probeDistance,
    antenna[1] + Math.sin(angle) * probeDistance,
  ];
  return blockers.some(({ building }) => pointInPolygonInterior(probe, building.vertices));
}

function isToleranceSensitiveSlab(
  active: ActiveSegmentTreap,
  antenna: Coordinate,
  angle: number,
): boolean {
  active.setAngle(angle);
  const nearest = active.minimum();
  if (nearest === undefined) return false;
  const nearestDistance = rayIntersectionDistance(nearest.edge, antenna, angle);
  if (!Number.isFinite(nearestDistance)) return false;
  const nearby = active.minimumsWithinDistance(nearestDistance + FALLBACK_DISTANCE_METERS);
  const firstTwo = nearby.length >= 2 ? nearby : active.firstSegments(2);
  // Radial distance alone misses shallow crossings near a polygon vertex: the
  // entry and exit may be far apart along the ray while penetration is tiny.
  const incidentNearRay = firstTwo.length >= 2
    && sharedEndpoints(firstTwo[0]?.edge, firstTwo[1]?.edge).some((endpoint) =>
      pointToRayDistance(endpoint, antenna, angle) <= FALLBACK_DISTANCE_METERS);
  return nearby.length >= 2 || incidentNearRay;
}

function sharedEndpoints(
  first: BuildingEdge | undefined,
  second: BuildingEdge | undefined,
): Coordinate[] {
  if (first === undefined || second === undefined) return [];
  return [first.start, first.end].filter((endpoint) =>
    coordinatesEqual(endpoint, second.start) || coordinatesEqual(endpoint, second.end));
}

function coordinatesEqual(first: Coordinate, second: Coordinate): boolean {
  return first[0] === second[0] && first[1] === second[1];
}

function pointToRayDistance(point: Coordinate, origin: Coordinate, angle: number): number {
  const vector = subtract(point, origin);
  const direction: Coordinate = [Math.cos(angle), Math.sin(angle)];
  if (dot(vector, direction) < 0) return Number.POSITIVE_INFINITY;
  return Math.abs(cross(vector, direction));
}

function pointInPolygonInterior(point: Coordinate, vertices: readonly Coordinate[]): boolean {
  let inside = false;
  for (const [index, start] of vertices.entries()) {
    const end = vertices[(index + 1) % vertices.length];
    if (end === undefined) continue;
    const crosses = (start[1] > point[1]) !== (end[1] > point[1]);
    if (
      crosses
      && point[0] < (end[0] - start[0]) * (point[1] - start[1]) / (end[1] - start[1])
        + start[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function recordSlabCandidate(
  dataset: BuildingDataset,
  visible: SweepVisibleIntervals,
  fallbackEdges: Map<number, EdgeLocation>,
  segment: SweepSegment,
  antenna: Coordinate,
  startAngle: number,
  endAngle: number,
  probeAngle: number,
  originBlockers: readonly OriginBlocker[],
  targetBuildingIndexes: ReadonlySet<number>,
): void {
  const building = dataset.buildings[segment.buildingInputIndex];
  if (!targetBuildingIndexes.has(segment.buildingInputIndex) || building === undefined) return;
  if (fallbackEdges.has(segment.id)) return;
  const startParameter = parameterAtRay(segment.edge, antenna, startAngle);
  const endParameter = parameterAtRay(segment.edge, antenna, endAngle);
  if (startParameter === undefined || endParameter === undefined) {
    fallbackEdges.set(segment.id, { building, edge: segment.edge });
    return;
  }
  if (isBlockedAtOrigin(antenna, probeAngle, originBlockers)) return;
  const interval = {
    start: Math.min(startParameter, endParameter),
    end: Math.max(startParameter, endParameter),
  };
  if (interval.end - interval.start <= PARAMETER_EPSILON) return;
  addVisibleInterval(
    visible,
    segment.buildingInputIndex,
    segment.edge.edgeIndex,
    interval,
  );
}

function recordToleranceSlabCandidates(
  dataset: BuildingDataset,
  visible: SweepVisibleIntervals,
  fallbackEdges: Map<number, EdgeLocation>,
  active: ActiveSegmentTreap,
  antenna: Coordinate,
  startAngle: number,
  endAngle: number,
  probeAngle: number,
  originBlockers: readonly OriginBlocker[],
  targetBuildingIndexes: ReadonlySet<number>,
): void {
  if (isBlockedAtOrigin(antenna, probeAngle, originBlockers)) return;
  // Use the same edge-parameter midpoint convention as the reference engine.
  // Once ArcGIS finds a true blocker, every farther boundary remains shadowed.
  for (const segment of active.segmentsInOrder()) {
    const startParameter = parameterAtRay(segment.edge, antenna, startAngle);
    const endParameter = parameterAtRay(segment.edge, antenna, endAngle);
    if (startParameter === undefined || endParameter === undefined) {
      if (segment.target) {
        const building = dataset.buildings[segment.buildingInputIndex];
        if (building !== undefined) fallbackEdges.set(segment.id, { building, edge: segment.edge });
      }
      break;
    }
    const interval = {
      start: Math.min(startParameter, endParameter),
      end: Math.max(startParameter, endParameter),
    };
    const target = interpolate(
      segment.edge.start,
      segment.edge.end,
      (interval.start + interval.end) / 2,
    );
    if (isSightLineBlocked(dataset, antenna, target)) break;
    if (
      interval.end - interval.start > PARAMETER_EPSILON
      && targetBuildingIndexes.has(segment.buildingInputIndex)
      && !fallbackEdges.has(segment.id)
    ) {
      addVisibleInterval(
        visible,
        segment.buildingInputIndex,
        segment.edge.edgeIndex,
        interval,
      );
    }
  }
}

function addVisibleInterval(
  visible: SweepVisibleIntervals,
  buildingIndex: number,
  edgeIndex: number,
  interval: ParameterInterval,
): void {
  if (interval.end - interval.start <= PARAMETER_EPSILON) return;
  let buildingIntervals = visible.get(buildingIndex);
  if (buildingIntervals === undefined) {
    buildingIntervals = new Map();
    visible.set(buildingIndex, buildingIntervals);
  }
  const intervals = buildingIntervals.get(edgeIndex) ?? [];
  intervals.push(interval);
  buildingIntervals.set(edgeIndex, intervals);
}

function setVisibleIntervals(
  visible: SweepVisibleIntervals,
  buildingIndex: number,
  edgeIndex: number,
  intervals: readonly ParameterInterval[],
): void {
  let buildingIntervals = visible.get(buildingIndex);
  if (buildingIntervals === undefined) {
    buildingIntervals = new Map();
    visible.set(buildingIndex, buildingIntervals);
  }
  buildingIntervals.set(edgeIndex, [...intervals]);
}

function parameterAtRay(
  edge: BuildingEdge,
  antenna: Coordinate,
  angle: number,
): number | undefined {
  const direction: Coordinate = [Math.cos(angle), Math.sin(angle)];
  const edgeVector = subtract(edge.end, edge.start);
  const denominator = cross(direction, edgeVector);
  const scale = magnitude(edgeVector);
  if (Math.abs(denominator) <= Number.EPSILON * 64 * Math.max(1, scale)) return undefined;
  const fromAntenna = subtract(edge.start, antenna);
  const parameter = cross(fromAntenna, direction) / denominator;
  if (parameter < -PARAMETER_EPSILON || parameter > 1 + PARAMETER_EPSILON) return undefined;
  return Math.min(1, Math.max(0, parameter));
}

function rayIntersectionDistance(
  edge: BuildingEdge,
  antenna: Coordinate,
  angle: number,
): number {
  const direction: Coordinate = [Math.cos(angle), Math.sin(angle)];
  const edgeVector = subtract(edge.end, edge.start);
  const denominator = cross(direction, edgeVector);
  if (Math.abs(denominator) <= Number.EPSILON * 64 * Math.max(1, magnitude(edgeVector))) {
    return Number.POSITIVE_INFINITY;
  }
  return cross(subtract(edge.start, antenna), edgeVector) / denominator;
}

function pointToSegmentDistance(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const edge = subtract(end, start);
  const squaredLength = dot(edge, edge);
  if (squaredLength === 0) return magnitude(subtract(point, start));
  const parameter = Math.min(1, Math.max(0, dot(subtract(point, start), edge) / squaredLength));
  return magnitude(subtract(point, interpolate(start, end, parameter)));
}

function isExactlyRadial(first: Coordinate, second: Coordinate): boolean {
  const scale = magnitude(first) * magnitude(second);
  return dot(first, second) > 0
    && Math.abs(cross(first, second)) <= Number.EPSILON * 64 * Math.max(1, scale);
}

function eventKindOrder(event: SweepEvent): number {
  return event.kind === "end" ? 0 : 1;
}

function interpolate(start: Coordinate, end: Coordinate, parameter: number): Coordinate {
  return [
    start[0] + parameter * (end[0] - start[0]),
    start[1] + parameter * (end[1] - start[1]),
  ];
}

function normalizeAngle(angle: number): number {
  const normalized = angle % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function subtract(left: Coordinate, right: Coordinate): Coordinate {
  return [left[0] - right[0], left[1] - right[1]];
}

function cross(left: Coordinate, right: Coordinate): number {
  return left[0] * right[1] - left[1] * right[0];
}

function dot(left: Coordinate, right: Coordinate): number {
  return left[0] * right[0] + left[1] * right[1];
}

function magnitude(vector: Coordinate): number {
  return Math.hypot(vector[0], vector[1]);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Evaluation cancelled.", "AbortError");
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface TreapNode {
  readonly segment: SweepSegment;
  readonly priority: number;
  left?: TreapNode;
  right?: TreapNode;
  parent?: TreapNode;
}

class ActiveSegmentTreap {
  private root?: TreapNode;
  private readonly nodeById = new Map<number, TreapNode>();
  private targetCount = 0;

  public constructor(
    private readonly antenna: Coordinate,
    private angle: number,
  ) {}

  public setAngle(angle: number): void {
    this.angle = angle;
  }

  public insert(segment: SweepSegment): void {
    if (this.nodeById.has(segment.id)) return;
    const node: TreapNode = { segment, priority: hashPriority(segment.id) };
    this.nodeById.set(segment.id, node);
    if (segment.target) this.targetCount += 1;
    if (this.root === undefined) {
      this.root = node;
      return;
    }

    let current = this.root;
    while (true) {
      if (this.compare(segment, current.segment) < 0) {
        if (current.left === undefined) {
          current.left = node;
          node.parent = current;
          break;
        }
        current = current.left;
      } else {
        if (current.right === undefined) {
          current.right = node;
          node.parent = current;
          break;
        }
        current = current.right;
      }
    }

    while (node.parent !== undefined && node.priority < node.parent.priority) {
      if (node.parent.left === node) this.rotateRight(node.parent);
      else this.rotateLeft(node.parent);
    }
  }

  public remove(segmentId: number): void {
    const node = this.nodeById.get(segmentId);
    if (node === undefined) return;

    while (node.left !== undefined || node.right !== undefined) {
      if (node.left === undefined) this.rotateLeft(node);
      else if (node.right === undefined) this.rotateRight(node);
      else if (node.left.priority < node.right.priority) this.rotateRight(node);
      else this.rotateLeft(node);
    }

    if (node.parent === undefined) this.root = undefined;
    else if (node.parent.left === node) node.parent.left = undefined;
    else node.parent.right = undefined;
    this.nodeById.delete(segmentId);
    if (node.segment.target) this.targetCount -= 1;
  }

  public hasTarget(): boolean {
    return this.targetCount > 0;
  }

  public minimum(): SweepSegment | undefined {
    return this.minimumNode(this.root)?.segment;
  }

  public minimumsWithinDistance(maximumDistance: number): SweepSegment[] {
    const result: SweepSegment[] = [];
    const minimum = this.minimumNode(this.root);
    if (minimum === undefined) return result;
    let current: TreapNode | undefined = minimum;
    while (current !== undefined) {
      const distance = rayIntersectionDistance(current.segment.edge, this.antenna, this.angle);
      if (!Number.isFinite(distance) || distance > maximumDistance) break;
      result.push(current.segment);
      current = this.successor(current);
    }
    return result;
  }

  public firstSegments(count: number): SweepSegment[] {
    const result: SweepSegment[] = [];
    for (const segment of this.segmentsInOrder()) {
      result.push(segment);
      if (result.length >= count) break;
    }
    return result;
  }

  public *segmentsInOrder(): Generator<SweepSegment> {
    let current = this.minimumNode(this.root);
    while (current !== undefined) {
      yield current.segment;
      current = this.successor(current);
    }
  }

  private compare(left: SweepSegment, right: SweepSegment): number {
    // With non-overlapping footprints, two active edges cannot exchange radial
    // order inside an endpoint-bounded angular slab. The tree therefore needs
    // updates only when endpoint events insert or remove segments.
    const leftDistance = rayIntersectionDistance(left.edge, this.antenna, this.angle);
    const rightDistance = rayIntersectionDistance(right.edge, this.antenna, this.angle);
    const difference = leftDistance - rightDistance;
    if (Math.abs(difference) > DISTANCE_TIE_TOLERANCE_METERS) return difference;
    return left.id - right.id;
  }

  private minimumNode(node: TreapNode | undefined): TreapNode | undefined {
    if (node === undefined) return undefined;
    let current = node;
    while (current.left !== undefined) current = current.left;
    return current;
  }

  private successor(node: TreapNode): TreapNode | undefined {
    if (node.right !== undefined) return this.minimumNode(node.right);
    let current = node;
    while (current.parent !== undefined && current.parent.right === current) current = current.parent;
    return current.parent;
  }

  private rotateLeft(node: TreapNode): void {
    const pivot = node.right;
    if (pivot === undefined) return;
    node.right = pivot.left;
    if (pivot.left !== undefined) pivot.left.parent = node;
    this.replaceParentChild(node, pivot);
    pivot.left = node;
    node.parent = pivot;
  }

  private rotateRight(node: TreapNode): void {
    const pivot = node.left;
    if (pivot === undefined) return;
    node.left = pivot.right;
    if (pivot.right !== undefined) pivot.right.parent = node;
    this.replaceParentChild(node, pivot);
    pivot.right = node;
    node.parent = pivot;
  }

  private replaceParentChild(node: TreapNode, replacement: TreapNode): void {
    const parent = node.parent;
    replacement.parent = parent;
    if (parent === undefined) this.root = replacement;
    else if (parent.left === node) parent.left = replacement;
    else parent.right = replacement;
  }
}

function hashPriority(value: number): number {
  let hash = (value + 1) | 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}
