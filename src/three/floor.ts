import * as THREE from 'three';

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
    var loader = new THREE.TextureLoader();
    var floorTexture = loader.load(textureSettings.url);
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(1, 1);
    var floorMaterialTop = new THREE.MeshPhongMaterial({
      map: floorTexture,
      side: THREE.DoubleSide,
      color: 0xcccccc,
      specular: 0x0a0a0a
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
