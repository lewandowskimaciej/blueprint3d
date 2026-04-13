import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { loadTextureCompat } from '../core/texture_loader';

export var Floor = function (scene, room) {
  var scope = this;
  this.room = room;
  var floorPlane: THREE.Mesh = null;

  init();

  function init() {
    scope.room.fireOnFloorChange(redraw);
    floorPlane = buildFloor();
  }

  function redraw() {
    scope.removeFromScene();
    floorPlane = buildFloor();
    scope.addToScene();
  }

    function buildFloor(): THREE.Mesh {
      var textureSettings = scope.room.getTexture();
    var floorTexture = loadTextureCompat(textureSettings.url, () => {
      scene.needsUpdate = true;
    });
    floorTexture.colorSpace = THREE.SRGBColorSpace;
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(1, 1);
    const useNodeMaterial = typeof scene.getMaterialMode === 'function' && scene.getMaterialMode() === 'node';
    // Polished hardwood / laminate: moderate roughness, thin clear-coat layer,
    // stronger IBL contribution now that RoomEnvironment is set on the scene.
    var floorMaterialTop = useNodeMaterial
      ? new (MeshPhysicalNodeMaterial as any)({
          map: floorTexture,
          side: THREE.DoubleSide,
          color: 0xffffff,
          roughness: 0.72,
          metalness: 0.02,
          clearcoat: 0.20,
          clearcoatRoughness: 0.12,
          envMapIntensity: 1.6
        })
      : new THREE.MeshPhysicalMaterial({
          map: floorTexture,
          side: THREE.DoubleSide,
          color: 0xffffff,
          roughness: 0.72,
          metalness: 0.02,
          clearcoat: 0.20,
          clearcoatRoughness: 0.12,
          envMapIntensity: 1.6
        });

    var textureScale = textureSettings.scale;
    var points: THREE.Vector2[] = [];
    scope.room.interiorCorners.forEach((corner) => {
      points.push(new THREE.Vector2(corner.x / textureScale, corner.y / textureScale));
    });
    var shape = new THREE.Shape(points);
    var geometry = new THREE.ShapeGeometry(shape);
    var floor = new THREE.Mesh(geometry, floorMaterialTop);
    floor.rotation.set(Math.PI / 2, 0, 0);
    floor.scale.set(textureScale, textureScale, textureScale);
    floor.receiveShadow = true;
    floor.castShadow = false;
    return floor;
  }

  this.addToScene = function () {
    scene.add(floorPlane);
    scene.add(room.floorPlane);
  };

  this.removeFromScene = function () {
    scene.remove(floorPlane);
    scene.remove(room.floorPlane);
  };
};
