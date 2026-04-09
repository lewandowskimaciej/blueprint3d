import * as THREE from 'three';

export var HUD = function (three) {
  var scope = this;
  var scene = new THREE.Scene();
  var selectedItem = null;
  var rotating = false;
  var mouseover = false;
  var height = 5;
  var distance = 20;
  var color = "#ffffff";
  var hoverColor = "#f1c40f";
  var activeObject: THREE.Object3D = null;

  this.getScene = function () { return scene; };
  this.getObject = function () { return activeObject; };

  function init() {
    three.itemSelectedCallbacks.add(itemSelected);
    three.itemUnselectedCallbacks.add(itemUnselected);
  }

  function resetSelectedItem() {
    selectedItem = null;
    if (activeObject) {
      scene.remove(activeObject);
      activeObject = null;
    }
  }

  function itemSelected(item) {
    if (selectedItem != item) {
      resetSelectedItem();
      if (item.allowRotate && !item.fixed) {
        selectedItem = item;
        activeObject = makeObject(selectedItem);
        scene.add(activeObject);
      }
    }
  }

  function itemUnselected() { resetSelectedItem(); }

  this.setRotating = function (isRotating) {
    rotating = isRotating;
    setColor();
  };

  this.setMouseover = function (isMousedOver) {
    mouseover = isMousedOver;
    setColor();
  };

  function setColor() {
    if (activeObject) {
      activeObject.children.forEach((obj: any) => {
        obj.material.color.set(getColor());
      });
    }
    three.needsUpdate();
  }

  function getColor() {
    return (mouseover || rotating) ? hoverColor : color;
  }

  this.update = function () {
    if (activeObject) {
      activeObject.rotation.y = selectedItem.rotation.y;
      activeObject.position.x = selectedItem.position.x;
      activeObject.position.z = selectedItem.position.z;
    }
  };

  function makeLineGeometry(item): THREE.BufferGeometry {
    const points = [new THREE.Vector3(0, 0, 0), rotateVector(item)];
    const geometry = new THREE.BufferGeometry();
    (geometry as any).setFromPoints(points);
    return geometry;
  }

  function rotateVector(item): THREE.Vector3 {
    return new THREE.Vector3(0, 0,
      Math.max(item.halfSize.x, item.halfSize.z) + 1.4 + distance);
  }

  function makeLineMaterial(isRotating): THREE.LineBasicMaterial {
    return new THREE.LineBasicMaterial({ color: getColor(), linewidth: 3 });
  }

  function makeCone(item): THREE.Mesh {
    var coneGeo = new THREE.CylinderGeometry(5, 0, 10);
    var coneMat = new THREE.MeshBasicMaterial({ color: getColor() });
    var cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.copy(rotateVector(item));
    cone.rotation.x = -Math.PI / 2.0;
    return cone;
  }

  function makeSphere(item): THREE.Mesh {
    var geometry = new THREE.SphereGeometry(4, 16, 16);
    var material = new THREE.MeshBasicMaterial({ color: getColor() });
    return new THREE.Mesh(geometry, material);
  }

  function makeObject(item): THREE.Object3D {
    var object = new THREE.Object3D();
    var line = new THREE.LineSegments(
      makeLineGeometry(item),
      makeLineMaterial(scope.rotating)
    );
    object.add(line);
    object.add(makeCone(item));
    object.add(makeSphere(item));
    object.rotation.y = item.rotation.y;
    object.position.x = item.position.x;
    object.position.z = item.position.z;
    object.position.y = height;
    return object;
  }

  init();
};
