import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { Configuration, configWallHeight } from '../core/dimensioning';

// Warm halogen white ~2700 K
const LIGHT_COLOR = 0xfff0cc;
// Neutral dark-grey metal housing
const HOUSING_COLOR = 0x888480;
// Near-white lamp disc
const LAMP_COLOR = 0xfffaef;

/** Shoelace formula – returns absolute area in square scene-units. */
function computeArea(corners: any[]): number {
  var n = corners.length;
  var area = 0;
  for (var i = 0; i < n; i++) {
    var j = (i + 1) % n;
    area += corners[i].x * corners[j].y;
    area -= corners[j].x * corners[i].y;
  }
  return Math.abs(area) / 2;
}

function computeBounds(corners: any[]) {
  var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  corners.forEach((c) => {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.y); // 2-D corner.y == 3-D Z axis
    maxZ = Math.max(maxZ, c.y);
  });
  return { minX, maxX, minZ, maxZ, w: maxX - minX, h: maxZ - minZ };
}

/**
 * Returns one or more (x, z) positions for light fixtures, distributed
 * sensibly inside the room's bounding box.
 *
 * Thresholds are in square scene-units (scene scale is cm-ish).
 *   < 80 000  → 1 central light  (~< 8 m²)
 *   < 200 000 → 2 lights          (~< 20 m²)
 *   else      → 4 lights in 2×2 grid
 */
function getLightPositions(corners: any[]): Array<{ x: number; z: number }> {
  var area = computeArea(corners);
  var b = computeBounds(corners);
  var cx = (b.minX + b.maxX) / 2;
  var cz = (b.minZ + b.maxZ) / 2;

  if (area < 80000) {
    return [{ x: cx, z: cz }];
  }

  if (area < 200000) {
    if (b.w >= b.h) {
      var ox = b.w * 0.2;
      return [{ x: cx - ox, z: cz }, { x: cx + ox, z: cz }];
    }
    var oz = b.h * 0.2;
    return [{ x: cx, z: cz - oz }, { x: cx, z: cz + oz }];
  }

  var ox2 = b.w * 0.22;
  var oz2 = b.h * 0.22;
  return [
    { x: cx - ox2, z: cz - oz2 },
    { x: cx + ox2, z: cz - oz2 },
    { x: cx - ox2, z: cz + oz2 },
    { x: cx + ox2, z: cz + oz2 }
  ];
}

/**
 * Creates and manages interior ceiling spotlights for one room.
 *
 * Each fixture consists of:
 *   - A recessed housing ring  (annular disc flush with the ceiling)
 *   - An emissive lamp disc    (warm glow at bulb position)
 *   - A THREE.SpotLight        (actual illumination + shadows)
 *
 * Fixture meshes are toggled via cameraMovedCallbacks so they are only
 * visible when the viewer is inside the room (camera Y < ceiling height).
 * The SpotLights themselves are always active so the floor is always lit.
 */
export var RoomLights = function (scene, room, controls) {
  var lights: THREE.SpotLight[] = [];
  var lightTargets: THREE.Object3D[] = [];
  var fixtureMeshes: THREE.Mesh[] = [];
  var wallHeight = Configuration.getNumericValue(configWallHeight);
  var fixtureVisible = true;

  // ── fixture geometry ──────────────────────────────────────────────────

  function createFixtureMeshes(x: number, z: number): THREE.Mesh[] {
    const useNode =
      typeof scene.getMaterialMode === 'function' &&
      scene.getMaterialMode() === 'node';

    // Outer ring – housing
    var housingGeo = new THREE.RingGeometry(4.2, 7.5, 32);
    var housingMat = useNode
      ? new (MeshPhysicalNodeMaterial as any)({
          color: HOUSING_COLOR,
          side: THREE.FrontSide,
          roughness: 0.5,
          metalness: 0.82
        })
      : new THREE.MeshPhysicalMaterial({
          color: HOUSING_COLOR,
          side: THREE.FrontSide,
          roughness: 0.5,
          metalness: 0.82
        });
    var housing = new THREE.Mesh(housingGeo, housingMat);
    housing.rotation.x = Math.PI / 2; // face downward
    housing.position.set(x, wallHeight - 0.4, z);
    housing.castShadow = false;
    housing.receiveShadow = false;

    // Inner disc – emissive bulb
    var lampGeo = new THREE.CircleGeometry(4.0, 32);
    var lampMat = useNode
      ? new (MeshPhysicalNodeMaterial as any)({
          color: LAMP_COLOR,
          emissive: new THREE.Color(LAMP_COLOR),
          emissiveIntensity: 15.0,
          roughness: 0.1,
          metalness: 0.0,
          side: THREE.FrontSide
        })
      : new THREE.MeshPhysicalMaterial({
          color: LAMP_COLOR,
          emissive: new THREE.Color(LAMP_COLOR),
          emissiveIntensity: 15.0,
          roughness: 0.1,
          metalness: 0.0,
          side: THREE.FrontSide
        });
    var lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(x, wallHeight - 1.0, z);
    lamp.castShadow = false;
    lamp.receiveShadow = false;

    return [housing, lamp];
  }

  // ── SpotLight ─────────────────────────────────────────────────────────

  function createSpotLight(
    x: number,
    z: number,
    castShadow: boolean
  ): { light: THREE.SpotLight; target: THREE.Object3D } {
    var spot = new THREE.SpotLight(LIGHT_COLOR, 2.8);
    spot.angle = Math.PI / 6.5;    // Slightly wider beam for better room coverage
    spot.penumbra = 0.6;         // Softer edges
    spot.decay = 2.0;            // Physically correct fall-off

    var lightDist = wallHeight + 50;
    spot.distance = lightDist;
    spot.castShadow = castShadow;

    if (castShadow) {
      spot.shadow.mapSize.width = 1024;
      spot.shadow.mapSize.height = 1024;

      spot.shadow.camera.near = 1;
      spot.shadow.camera.far = lightDist;

      spot.shadow.bias = -0.0001; 
      spot.shadow.normalBias = 0.02;
    }

    spot.position.set(x, wallHeight - 2, z);

    var target = new THREE.Object3D();
    target.position.set(x, 0, z);
    spot.target = target;

    return { light: spot, target };
  }

  // ── visibility ────────────────────────────────────────────────────────

  function updateFixtureVisibility() {
    var camY = (controls.object as THREE.Camera).position.y;
    // Show fixtures only when inside the room (camera below ceiling)
    // Show fixtures when camera is reasonably close or inside (elevation < 1.5 * wallHeight)
    var visible = camY < wallHeight * 1.5;
    if (visible !== fixtureVisible) {
      fixtureVisible = visible;
      fixtureMeshes.forEach((m) => { m.visible = visible; });
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  function build() {
    var corners = room.interiorCorners;
    if (!corners || corners.length < 3) return;

    var positions = getLightPositions(corners);

    positions.forEach((pos, index) => {
      // Fixture visual
      createFixtureMeshes(pos.x, pos.z).forEach((m) => {
        scene.add(m as any);
        fixtureMeshes.push(m);
      });

      // Spotlight – only the first light in each room casts shadows
      var { light, target } = createSpotLight(pos.x, pos.z, index === 0);
      scene.add(light as any);
      scene.add(target as any);
      lights.push(light);
      lightTargets.push(target);
    });

    controls.cameraMovedCallbacks.add(updateFixtureVisibility);
    updateFixtureVisibility();
  }

  function removeAll() {
    lights.forEach((l) => scene.remove(l as any));
    lightTargets.forEach((t) => scene.remove(t as any));
    fixtureMeshes.forEach((m) => scene.remove(m as any));
    lights = [];
    lightTargets = [];
    fixtureMeshes = [];
  }

  function redraw() {
    controls.cameraMovedCallbacks.remove(updateFixtureVisibility);
    removeAll();
    build();
  }

  this.remove = function () {
    controls.cameraMovedCallbacks.remove(updateFixtureVisibility);
    removeAll();
  };

  this.addToScene = function () { /* already handled inside build() */ };
  this.removeFromScene = removeAll;

  room.fireOnFloorChange(redraw);
  build();
};
