import * as THREE from 'three';
import { Utils } from '../core/utils';
import { Callbacks } from '../core/callbacks';

export var Controller = function (three, model, camera, element, controls, hud) {
  var scope = this;

  this.enabled = true;
  this.itemTransformCompletedCallbacks = new Callbacks();

  var scene = model.scene;
  var plane: THREE.Mesh;
  var mouse: THREE.Vector2;
  var intersectedObject;
  var mouseoverObject;
  var selectedObject;

  var mouseDown = false;
  var mouseMoved = false;
  var rotateMouseOver = false;

  var states = {
    UNSELECTED: 0,
    SELECTED: 1,
    DRAGGING: 2,
    ROTATING: 3,
    ROTATING_FREE: 4,
    PANNING: 5
  };
  var state = states.UNSELECTED;

  this.needsUpdate = true;

  function init() {
    element.addEventListener('mousedown', mouseDownEvent);
    element.addEventListener('mouseup', mouseUpEvent);
    element.addEventListener('mousemove', mouseMoveEvent);
    mouse = new THREE.Vector2();
    scene.itemRemovedCallbacks.add(itemRemoved);
    scene.itemLoadedCallbacks.add(itemLoaded);
    setGroundPlane();
  }

  function itemLoaded(item) {
    if (!item) {
      return;
    }
    if (!item.position_set) {
      scope.setSelectedObject(item);
      switchState(states.DRAGGING);
      var pos = item.position.clone();
      pos.y = 0;
      var vec = three.projectVector(pos);
      clickPressed(vec);
    }
    item.position_set = true;
  }

  function clickPressed(vec2?) {
    vec2 = vec2 || mouse;
    var intersection = scope.itemIntersection(mouse, selectedObject);
    if (intersection) selectedObject.clickPressed(intersection);
  }

  function clickDragged(vec2?) {
    vec2 = vec2 || mouse;
    var intersection = scope.itemIntersection(mouse, selectedObject);
    if (intersection) {
      if (scope.isRotating()) selectedObject.rotate(intersection);
      else selectedObject.clickDragged(intersection);
    }
  }

  function itemRemoved(item) {
    if (item === selectedObject) {
      selectedObject.setUnselected();
      selectedObject.mouseOff();
      scope.setSelectedObject(null);
    }
  }

  function setGroundPlane() {
    var size = 10000;
    plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial());
    plane.rotation.x = -Math.PI / 2;
    plane.visible = false;
    scene.add(plane);
  }

  function checkWallsAndFloors(event?) {
    if (state == states.UNSELECTED && mouseoverObject == null) {
      var wallEdgePlanes = model.floorplan.wallEdgePlanes();
      var wallIntersects = scope.getIntersections(mouse, wallEdgePlanes, true);
      if (wallIntersects.length > 0) {
        three.wallClicked.fire(wallIntersects[0].object.edge);
        return;
      }
      var floorPlanes = model.floorplan.floorPlanes();
      var floorIntersects = scope.getIntersections(mouse, floorPlanes, false);
      if (floorIntersects.length > 0) {
        three.floorClicked.fire(floorIntersects[0].object.room);
        return;
      }
      three.nothingClicked.fire();
    }
  }

  function mouseMoveEvent(event) {
    if (scope.enabled) {
      event.preventDefault();
      mouseMoved = true;
      mouse.x = event.clientX;
      mouse.y = event.clientY;
      if (!mouseDown) updateIntersections();
      switch (state) {
        case states.UNSELECTED:
        case states.SELECTED:
          updateMouseover();
          break;
        case states.DRAGGING:
        case states.ROTATING:
        case states.ROTATING_FREE:
          clickDragged();
          hud.update();
          scope.needsUpdate = true;
          break;
      }
    }
  }

  this.isRotating = function () {
    return (state == states.ROTATING || state == states.ROTATING_FREE);
  };

  function mouseDownEvent(event) {
    if (scope.enabled) {
      event.preventDefault();
      mouseMoved = false;
      mouseDown = true;
      switch (state) {
        case states.SELECTED:
          if (rotateMouseOver) {
            switchState(states.ROTATING);
          } else if (intersectedObject != null) {
            scope.setSelectedObject(intersectedObject);
            if (!intersectedObject.fixed) switchState(states.DRAGGING);
          }
          break;
        case states.UNSELECTED:
          if (intersectedObject != null) {
            scope.setSelectedObject(intersectedObject);
            if (!intersectedObject.fixed) switchState(states.DRAGGING);
          }
          break;
        case states.ROTATING_FREE:
          switchState(states.SELECTED);
          break;
      }
    }
  }

  function mouseUpEvent(event) {
    if (scope.enabled) {
      mouseDown = false;
      switch (state) {
        case states.DRAGGING:
          selectedObject.clickReleased();
          switchState(states.SELECTED);
          scope.itemTransformCompletedCallbacks.fire(selectedObject);
          break;
        case states.ROTATING:
          if (!mouseMoved) switchState(states.ROTATING_FREE);
          else {
            switchState(states.SELECTED);
            scope.itemTransformCompletedCallbacks.fire(selectedObject);
          }
          break;
        case states.UNSELECTED:
          if (!mouseMoved) checkWallsAndFloors();
          break;
        case states.SELECTED:
          if (intersectedObject == null && !mouseMoved) {
            switchState(states.UNSELECTED);
            checkWallsAndFloors();
          }
          break;
      }
    }
  }

  function switchState(newState) {
    if (newState != state) {
      onExit(state);
      onEntry(newState);
    }
    state = newState;
    hud.setRotating(scope.isRotating());
  }

  function onEntry(state) {
    switch (state) {
      case states.UNSELECTED:
        scope.setSelectedObject(null);
        // fall through
      case states.SELECTED:
        controls.enabled = true;
        break;
      case states.ROTATING:
      case states.ROTATING_FREE:
        controls.enabled = false;
        break;
      case states.DRAGGING:
        three.setCursorStyle("move");
        clickPressed();
        controls.enabled = false;
        break;
    }
  }

  function onExit(state) {
    switch (state) {
      case states.DRAGGING:
        if (mouseoverObject) three.setCursorStyle("pointer");
        else three.setCursorStyle("auto");
        break;
    }
  }

  this.selectedObject = function () { return selectedObject; };

  function updateIntersections() {
    var hudObject = hud.getObject();
    if (hudObject != null) {
      var hudIntersects = scope.getIntersections(mouse, hudObject, false, false, true);
      if (hudIntersects.length > 0) {
        rotateMouseOver = true;
        hud.setMouseover(true);
        intersectedObject = null;
        return;
      }
    }
    rotateMouseOver = false;
    hud.setMouseover(false);
    var items = model.scene.getItems();
    var intersects = scope.getIntersections(mouse, items, false, true);
    intersectedObject = intersects.length > 0 ? intersects[0].object : null;
  }

  function normalizeVector2(vec2) {
    var retVec = new THREE.Vector2();
    retVec.x = ((vec2.x - three.widthMargin) / (window.innerWidth - three.widthMargin)) * 2 - 1;
    retVec.y = -((vec2.y - three.heightMargin) / (window.innerHeight - three.heightMargin)) * 2 + 1;
    return retVec;
  }

  function mouseToVec3(vec2) {
    var normVec2 = normalizeVector2(vec2);
    var vector = new THREE.Vector3(normVec2.x, normVec2.y, 0.5);
    vector.unproject(camera);
    return vector;
  }

  this.itemIntersection = function (vec2, item) {
    var customIntersections = item.customIntersectionPlanes();
    var intersections = null;
    if (customIntersections && customIntersections.length > 0) {
      intersections = this.getIntersections(vec2, customIntersections, true);
    } else {
      intersections = this.getIntersections(vec2, plane);
    }
    if (intersections.length > 0) return intersections[0];
    return null;
  };

  this.getIntersections = function (vec2, objects, filterByNormals?, onlyVisible?, recursive?, linePrecision?) {
    var vector = mouseToVec3(vec2);
    onlyVisible = onlyVisible || false;
    filterByNormals = filterByNormals || false;
    recursive = recursive || false;
    linePrecision = linePrecision || 20;

    var direction = vector.sub(camera.position).normalize();
    var raycaster = new THREE.Raycaster(camera.position, direction);
    raycaster.params.Line.threshold = linePrecision;

    var intersections;
    if (objects instanceof Array) {
      intersections = raycaster.intersectObjects(objects, recursive);
    } else {
      intersections = raycaster.intersectObject(objects, recursive);
    }

    if (onlyVisible) {
      intersections = Utils.removeIf(intersections, (intersection) => !intersection.object.visible);
    }
    if (filterByNormals) {
      intersections = Utils.removeIf(intersections, (intersection) => {
        return intersection.face && intersection.face.normal.dot(direction) > 0;
      });
    }
    return intersections;
  };

  this.setSelectedObject = function (object) {
    if (state === states.UNSELECTED) switchState(states.SELECTED);
    if (selectedObject != null) selectedObject.setUnselected();
    if (object != null) {
      selectedObject = object;
      selectedObject.setSelected();
      three.itemSelectedCallbacks.fire(object);
    } else {
      selectedObject = null;
      three.itemUnselectedCallbacks.fire();
    }
    this.needsUpdate = true;
  };

  function updateMouseover() {
    if (intersectedObject != null) {
      if (mouseoverObject != null) {
        if (mouseoverObject !== intersectedObject) {
          mouseoverObject.mouseOff();
          mouseoverObject = intersectedObject;
          mouseoverObject.mouseOver();
          scope.needsUpdate = true;
        }
      } else {
        mouseoverObject = intersectedObject;
        mouseoverObject.mouseOver();
        three.setCursorStyle("pointer");
        scope.needsUpdate = true;
      }
    } else if (mouseoverObject != null) {
      mouseoverObject.mouseOff();
      three.setCursorStyle("auto");
      mouseoverObject = null;
      scope.needsUpdate = true;
    }
  }

  init();
};
