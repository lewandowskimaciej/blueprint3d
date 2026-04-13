import * as THREE from 'three';

export var Skybox = function (scene) {
  var skyColor = 0xf2f5fb;
  var sphereColor = 0xffffff;
  var sphereRadius = 4500;

  function init() {
    var threeScene = typeof scene.getScene === 'function' ? scene.getScene() : scene;
    if (threeScene) {
      threeScene.background = new THREE.Color(skyColor);
      threeScene.fog = new THREE.Fog(new THREE.Color(skyColor), 3500, 14000);
    }

    var skyGeo = new THREE.SphereGeometry(sphereRadius, 24, 18);
    var skyMat = new THREE.MeshBasicMaterial({
      color: sphereColor,
      side: THREE.BackSide,
      depthWrite: false
    });

    var skySphere = new THREE.Mesh(skyGeo, skyMat);
    skySphere.renderOrder = -1;
    scene.add(skySphere);
  }

  init();
};
