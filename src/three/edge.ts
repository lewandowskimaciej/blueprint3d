import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { Utils } from '../core/utils';
import { loadTextureCompat } from '../core/texture_loader';

export var Edge = function (scene, edge, controls) {
  var scope = this;
  var wall = edge.wall;
  var front = edge.front;

  var planes: THREE.Mesh[] = [];
  var basePlanes: THREE.Mesh[] = [];
  var texture: THREE.Texture = null;

  var fillerColor = 0xdddddd;
  var sideColor = 0xcccccc;
  var baseColor = 0xdddddd;

  this.visible = false;

  this.remove = function () {
    edge.redrawCallbacks.remove(redraw);
    controls.cameraMovedCallbacks.remove(updateVisibility);
    removeFromScene();
  };

  function init() {
    edge.redrawCallbacks.add(redraw);
    controls.cameraMovedCallbacks.add(updateVisibility);
    updateTexture();
    updatePlanes();
    addToScene();
  }

  function redraw() {
    removeFromScene();
    updateTexture();
    updatePlanes();
    addToScene();
  }

  function removeFromScene() {
    planes.forEach((plane) => { scene.remove(plane); });
    basePlanes.forEach((plane) => { scene.remove(plane); });
    planes = [];
    basePlanes = [];
  }

  function addToScene() {
    planes.forEach((plane) => { scene.add(plane); });
    basePlanes.forEach((plane) => { scene.add(plane); });
    updateVisibility();
  }

  function updateVisibility() {
    var start = edge.interiorStart();
    var end = edge.interiorEnd();
    var x = end.x - start.x;
    var y = end.y - start.y;
    var normal = new THREE.Vector3(-y, 0, x);
    normal.normalize();

    var position = controls.object.position.clone();
    var focus = new THREE.Vector3(
      (start.x + end.x) / 2.0, 0,
      (start.y + end.y) / 2.0);
    var direction = position.sub(focus).normalize();

    var dot = normal.dot(direction);
    scope.visible = (dot >= 0);
    planes.forEach((plane) => { plane.visible = scope.visible; });
    updateObjectVisibility();
  }

  function updateObjectVisibility() {
    wall.items.forEach((item) => { item.updateEdgeVisibility(scope.visible, front); });
    wall.onItems.forEach((item) => { item.updateEdgeVisibility(scope.visible, front); });
  }

  function updateTexture(callback?: any) {
    callback = callback || function () { scene.needsUpdate = true; };
    var textureData = edge.getTexture();
    var stretch = textureData.stretch;
    var url = textureData.url;
    var scale = textureData.scale;
    texture = loadTextureCompat(url, () => callback());
    texture.colorSpace = THREE.SRGBColorSpace;
    if (!stretch) {
      var height = wall.height;
      var width = edge.interiorDistance();
      texture.wrapT = THREE.RepeatWrapping;
      texture.wrapS = THREE.RepeatWrapping;
      texture.repeat.set(width / scale, height / scale);
      texture.needsUpdate = true;
    }
  }

  function updatePlanes() {
    const useNodeMaterial = typeof scene.getMaterialMode === 'function' && scene.getMaterialMode() === 'node';
    // Painted interior wall: high roughness, minimal sheen, subtle IBL contribution.
    var wallMaterial = useNodeMaterial
      ? new (MeshPhysicalNodeMaterial as any)({
          color: 0xffffff,
          side: THREE.FrontSide,
          map: texture,
          roughness: 0.88,
          metalness: 0.0,
          clearcoat: 0.05,
          clearcoatRoughness: 0.5,
          envMapIntensity: 1.2
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          side: THREE.FrontSide,
          map: texture,
          roughness: 0.88,
          metalness: 0.0,
          clearcoat: 0.05,
          clearcoatRoughness: 0.5,
          envMapIntensity: 1.2
        });

    var fillerMaterial = useNodeMaterial
      ? new (MeshPhysicalNodeMaterial as any)({
          color: fillerColor,
          side: THREE.DoubleSide,
          roughness: 0.95,
          metalness: 0.0,
          envMapIntensity: 0.9
        })
      : new THREE.MeshPhysicalMaterial({
          color: fillerColor,
          side: THREE.DoubleSide,
          roughness: 0.95,
          metalness: 0.0,
          envMapIntensity: 0.9
        });

    planes.push(makeWall(
      edge.exteriorStart(), edge.exteriorEnd(),
      edge.exteriorTransform, edge.invExteriorTransform, fillerMaterial));

    planes.push(makeWall(
      edge.interiorStart(), edge.interiorEnd(),
      edge.interiorTransform, edge.invInteriorTransform, wallMaterial));

    basePlanes.push(buildFiller(edge, 0, THREE.BackSide, baseColor));
    planes.push(buildFiller(edge, wall.height, THREE.DoubleSide, fillerColor));

    planes.push(buildSideFiller(
      edge.interiorStart(), edge.exteriorStart(), wall.height, sideColor));
    planes.push(buildSideFiller(
      edge.interiorEnd(), edge.exteriorEnd(), wall.height, sideColor));
  }

  function makeWall(start, end, transform: THREE.Matrix4, invTransform: THREE.Matrix4, material: THREE.Material) {
    var v1 = toVec3(start);
    var v2 = toVec3(end);
    var v3 = v2.clone(); v3.y = wall.height;
    var v4 = v1.clone(); v4.y = wall.height;

    var points = [v1.clone(), v2.clone(), v3.clone(), v4.clone()];
    points.forEach((p) => { p.applyMatrix4(transform); });

    var shape = new THREE.Shape([
      new THREE.Vector2(points[0].x, points[0].y),
      new THREE.Vector2(points[1].x, points[1].y),
      new THREE.Vector2(points[2].x, points[2].y),
      new THREE.Vector2(points[3].x, points[3].y)
    ]);

    wall.items.forEach((item) => {
      var pos = item.position.clone();
      pos.applyMatrix4(transform);
      var halfSize = item.halfSize;
      var min = halfSize.clone().multiplyScalar(-1);
      var max = halfSize.clone();
      min.add(pos);
      max.add(pos);
      shape.holes.push(new THREE.Path([
        new THREE.Vector2(min.x, min.y),
        new THREE.Vector2(max.x, min.y),
        new THREE.Vector2(max.x, max.y),
        new THREE.Vector2(min.x, max.y)
      ]));
    });

    var geometry = new THREE.ShapeGeometry(shape);
    var geomBuf = geometry as unknown as THREE.BufferGeometry;

    var posAttr = geomBuf.getAttribute('position') as THREE.BufferAttribute;
    var totalDistance = Utils.distance(v1.x, v1.z, v2.x, v2.z);
    var height = wall.height;
    var uvs = new Float32Array(posAttr.count * 2);

    var tmpVec = new THREE.Vector3();
    for (var i = 0; i < posAttr.count; i++) {
      (tmpVec as any).fromBufferAttribute(posAttr, i);
      tmpVec.applyMatrix4(invTransform);
      posAttr.setXYZ(i, tmpVec.x, tmpVec.y, tmpVec.z);
      uvs[i * 2] = Utils.distance(v1.x, v1.z, tmpVec.x, tmpVec.z) / totalDistance;
      uvs[i * 2 + 1] = tmpVec.y / height;
    }
    posAttr.needsUpdate = true;
    (geomBuf as any).setAttribute('uv', new THREE.BufferAttribute(uvs as any, 2));
    geomBuf.computeVertexNormals();

    return new THREE.Mesh(geometry, material);
  }

  function buildSideFiller(p1, p2, height: number, color: number) {
    const verts: THREE.Vector3[] = [
      toVec3(p1), toVec3(p2), toVec3(p2, height),
      toVec3(p1), toVec3(p2, height), toVec3(p1, height)
    ];
    const geometry = new THREE.BufferGeometry();
    (geometry as any).setFromPoints(verts);
    const useNodeMaterial = typeof scene.getMaterialMode === 'function' && scene.getMaterialMode() === 'node';
    const material = useNodeMaterial
      ? new (MeshPhysicalNodeMaterial as any)({
          color,
          side: THREE.DoubleSide,
          roughness: 0.95,
          metalness: 0.0,
          envMapIntensity: 0.85
        })
      : new THREE.MeshPhysicalMaterial({
          color,
          side: THREE.DoubleSide,
          roughness: 0.95,
          metalness: 0.0,
          envMapIntensity: 0.85
        });
    return new THREE.Mesh(geometry, material);
  }

  function buildFiller(edge, height: number, side: THREE.Side, color: number) {
    var points = [
      toVec2(edge.exteriorStart()), toVec2(edge.exteriorEnd()),
      toVec2(edge.interiorEnd()), toVec2(edge.interiorStart())
    ];
    var shape = new THREE.Shape(points);
    var geometry = new THREE.ShapeGeometry(shape);
    const useNodeMaterial = typeof scene.getMaterialMode === 'function' && scene.getMaterialMode() === 'node';
    const material = useNodeMaterial
      ? new (MeshPhysicalNodeMaterial as any)({
          color,
          side,
          roughness: 0.95,
          metalness: 0.0,
          envMapIntensity: 0.85
        })
      : new THREE.MeshPhysicalMaterial({
          color,
          side,
          roughness: 0.95,
          metalness: 0.0,
          envMapIntensity: 0.85
        });
    var filler = new THREE.Mesh(geometry, material);
    filler.rotation.set(Math.PI / 2, 0, 0);
    filler.position.y = height;
    return filler;
  }

  function toVec2(pos): THREE.Vector2 {
    return new THREE.Vector2(pos.x, pos.y);
  }

  function toVec3(pos, height: number = 0): THREE.Vector3 {
    return new THREE.Vector3(pos.x, height, pos.y);
  }

  init();
};
