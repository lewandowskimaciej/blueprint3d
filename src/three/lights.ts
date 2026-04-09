import * as THREE from 'three';

export var Lights = function (scene, floorplan) {
  var tol = 1;
  var height = 300;
  var dirLight: THREE.DirectionalLight;

  this.getDirLight = function () { return dirLight; };

  function init() {
    var light = new THREE.HemisphereLight(0xffffff, 0x888888, 1.1);
    light.position.set(0, height, 0);
    scene.add(light);

    dirLight = new THREE.DirectionalLight(0xffffff, 0);
    dirLight.color.setHSL(1, 1, 0.1);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    (dirLight.shadow.camera as THREE.OrthographicCamera).far = height + tol;
    (dirLight.shadow as any).bias = -0.0001;
    dirLight.shadow.camera.visible = false;

    scene.add(dirLight);
    scene.add(dirLight.target);
    floorplan.fireOnUpdatedRooms(updateShadowCamera);
  }

  function updateShadowCamera() {
    var size = floorplan.getSize();
    var d = (Math.max(size.z, size.x) + tol) / 2.0;
    var center = floorplan.getCenter();
    dirLight.position.copy(new THREE.Vector3(center.x, height, center.z));
    dirLight.target.position.copy(center);
    var shadowCam = dirLight.shadow.camera as THREE.OrthographicCamera;
    shadowCam.left = -d;
    shadowCam.right = d;
    shadowCam.top = d;
    shadowCam.bottom = -d;
    shadowCam.updateProjectionMatrix();
  }

  init();
};
