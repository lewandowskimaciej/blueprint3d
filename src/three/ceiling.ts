import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { Configuration, configWallHeight } from '../core/dimensioning';

/**
 * Renders a ceiling for a room.
 * Uses THREE.BackSide so the surface is only visible when the camera is
 * below ceiling height (interior perspective). From a top-down bird's-eye
 * view the camera is above the plane and the back-face is naturally culled.
 */
export var Ceiling = function (scene, room, _controls) {
  var ceilingMesh: THREE.Mesh = null;
  var wallHeight = Configuration.getNumericValue(configWallHeight);

  function buildCeiling(): THREE.Mesh {
    var corners = room.interiorCorners;
    if (!corners || corners.length < 3) return null;

    const useNodeMaterial =
      typeof scene.getMaterialMode === 'function' &&
      scene.getMaterialMode() === 'node';

    // Pure white plaster ceiling.
    // The ShapeGeometry in XY-plane has a +Z normal. After rotation.set(PI/2, 0, 0)
    // the normal becomes (0, -1, 0) – pointing DOWN into the room.
    // THREE.FrontSide therefore renders only when the camera is BELOW the ceiling
    // (interior view). From a bird's-eye view the camera is above the plane,
    // sees the back face and the ceiling is naturally culled.
    var mat = useNodeMaterial
      ? new (MeshPhysicalNodeMaterial as any)({
          color: 0xffffff,
          side: THREE.FrontSide,
          roughness: 0.60,
          metalness: 0.0,
          envMapIntensity: 1.0
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          side: THREE.FrontSide,
          roughness: 0.60,
          metalness: 0.0,
          envMapIntensity: 1.0
        });

    var points: THREE.Vector2[] = [];
    corners.forEach((corner) => {
      points.push(new THREE.Vector2(corner.x, corner.y));
    });
    var shape = new THREE.Shape(points);
    var geometry = new THREE.ShapeGeometry(shape);

    var mesh = new THREE.Mesh(geometry, mat);
    mesh.rotation.set(Math.PI / 2, 0, 0);
    mesh.position.y = wallHeight;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  function redraw() {
    removeFromScene();
    ceilingMesh = buildCeiling();
    addToScene();
  }

  function addToScene() {
    if (ceilingMesh) scene.add(ceilingMesh);
  }

  function removeFromScene() {
    if (ceilingMesh) {
      scene.remove(ceilingMesh);
      ceilingMesh = null;
    }
  }

  this.addToScene = addToScene;
  this.removeFromScene = removeFromScene;

  this.remove = function () {
    removeFromScene();
  };

  // Rebuild ceiling if room shape changes (e.g. wall moved)
  room.fireOnFloorChange(redraw);
  ceilingMesh = buildCeiling();
};
