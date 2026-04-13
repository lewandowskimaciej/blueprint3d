import * as THREE from 'three';

/**
 * Global scene lighting.
 *
 * Composition goal: a realistic daylight setup that works both for the
 * exterior bird's-eye overview AND as ambient fill for the interior view
 * (where RoomLights SpotLights are the primary source).
 *
 *  • HemisphereLight  – sky/ground gradient; simulates open-sky diffuse
 *  • AmbientLight     – low-level fill to avoid pitch-black shadows
 *  • DirectionalLight (key)  – main sun-like source, casts shadows
 *  • DirectionalLight (fill) – cool-blue counter-light from opposite side
 *  • DirectionalLight (back) – subtle warm rim from behind for depth
 */
export var Lights = function (scene, floorplan) {
  var tol = 1;
  var height = 300;
  var dirLight: THREE.DirectionalLight;
  var fillLight: THREE.DirectionalLight;
  var backLight: THREE.DirectionalLight;

  this.getDirLight = function () { return dirLight; };

  function init() {
    // Sky: pale daylight blue  |  Ground: warm earth-tone bounce
    var hemi = new THREE.HemisphereLight(0xd6e8ff, 0x7a6048, 0.65);
    hemi.position.set(0, height, 0);
    scene.add(hemi);

    // Very subtle ambient fill – prevents completely black shadowed faces
    var ambient = new THREE.AmbientLight(0xfff8f0, 0.18);
    scene.add(ambient);

    // ── Key light (sun) ──────────────────────────────────────────────────
    dirLight = new THREE.DirectionalLight(0xfff5e8, 1.25);
    dirLight.color.setHSL(0.09, 0.30, 0.96);
    // Interior-centric setup: global sun does NOT cast shadows inside.
    // This eliminates diagonal moiré and conflicting shadow maps on the floor.
    dirLight.castShadow = false;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    (dirLight.shadow.camera as THREE.OrthographicCamera).far = height + tol;
    // Optimized shadow parameters to combat moiré (shadow acne) and aliasing.
    // normalBias pushes shadow origin to prevent acne on flat floors.
    // shadow.radius blurs edges to hide quantization/aliasing.
    dirLight.shadow.bias = 0.0001; 
    dirLight.shadow.normalBias = 0.05;
    (dirLight.shadow as any).radius = 3.0;
    dirLight.shadow.camera.visible = false;
    scene.add(dirLight);
    scene.add(dirLight.target);

    // ── Fill light (sky bounce, cool blue) ──────────────────────────────
    fillLight = new THREE.DirectionalLight(0xc8d8ff, 0.38);
    fillLight.castShadow = false;
    scene.add(fillLight);
    scene.add(fillLight.target);

    // ── Back / rim light (warm, no shadow) ──────────────────────────────
    backLight = new THREE.DirectionalLight(0xffecd2, 0.22);
    backLight.castShadow = false;
    scene.add(backLight);
    scene.add(backLight.target);

    floorplan.fireOnUpdatedRooms(updateShadowCamera);
    updateShadowCamera();
  }

  function updateShadowCamera() {
    var size = floorplan.getSize();
    var d = (Math.max(size.z, size.x) + tol) / 2.0;
    var center = floorplan.getCenter();

    // Key from upper-front-right (warm side)
    dirLight.position.copy(
      new THREE.Vector3(center.x + d * 0.7, height * 0.95, center.z + d * 0.5)
    );
    dirLight.target.position.copy(center);

    // Fill from lower-back-left (cool side)
    fillLight.position.copy(
      new THREE.Vector3(center.x - d * 1.0, height * 0.5, center.z - d * 0.9)
    );
    fillLight.target.position.copy(center);

    // Back rim from directly behind / slightly above
    backLight.position.copy(
      new THREE.Vector3(center.x - d * 0.4, height * 0.6, center.z - d * 1.2)
    );
    backLight.target.position.copy(center);

    var shadowCam = dirLight.shadow.camera as THREE.OrthographicCamera;
    shadowCam.left = -d;
    shadowCam.right = d;
    shadowCam.top = d;
    shadowCam.bottom = -d;
    shadowCam.updateProjectionMatrix();
  }

  init();
};
