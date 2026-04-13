import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Callbacks } from '../core/callbacks';
import { Skybox } from './skybox';
import { Controls } from './controls';
import { HUD } from './hud';
import { Controller } from './controller';
import { Floorplan as ThreeFloorplan } from './floorplan';
import { Lights } from './lights';

export var Main = function (model, element, canvasElement, opts) {
  var scope = this;
  opts = opts || {};

  var options = {
    resize: true,
    pushHref: false,
    spin: true,
    spinSpeed: .00002,
    clickPan: true,
    canMoveFixedItems: false,
    renderEnabled: true,
    preferWebGPU: true
  };

  for (var opt in options) {
    if ((options as any).hasOwnProperty(opt) && opts.hasOwnProperty(opt)) {
      (options as any)[opt] = opts[opt];
    }
  }

  var scene = model.scene;

  this.element = typeof element === 'string' ? document.querySelector(element) : element;
  if (!this.element) {
    throw new Error(`Three container not found: ${element}`);
  }
  var domElement;

  var camera;
  var renderer: any;
  var rendererMode: 'webgpu' | 'webgl' = 'webgl';
  var rendererReady = true;
  this.controls;
  var controller;
  var floorplan;

  var needsUpdate = false;
  var lastRender = Date.now();
  var mouseOver = false;
  var hasClicked = false;

  var hud;

  this.heightMargin;
  this.widthMargin;
  this.elementHeight;
  this.elementWidth;

  this.itemSelectedCallbacks = new Callbacks();
  this.itemUnselectedCallbacks = new Callbacks();

  this.wallClicked = new Callbacks();
  this.floorClicked = new Callbacks();
  this.nothingClicked = new Callbacks();

  function hasWebGPUSupport() {
    return (
      typeof navigator !== 'undefined' &&
      !!(navigator as any).gpu &&
      typeof (globalThis as any).GPUCanvasContext !== 'undefined'
    );
  }

  function configureRendererDefaults(targetRenderer: any) {
    targetRenderer.autoClear = false;
    targetRenderer.shadowMap.enabled = true;
    // PCFSoftShadowMap gives smooth, artefact-free shadows for both directional
    // and spot lights without the frustum-sensitivity of VSMShadowMap.
    targetRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    targetRenderer.outputColorSpace = THREE.SRGBColorSpace;
    targetRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    targetRenderer.toneMappingExposure = 1.0;
    if ('useLegacyLights' in targetRenderer) {
      targetRenderer.useLegacyLights = false;
    }
  }

  /**
   * Generates a PMREMGenerator-based IBL environment from RoomEnvironment and
   * assigns it to the THREE.Scene.  This enables physically correct reflections
   * on all MeshPhysicalMaterial / MeshPhysicalNodeMaterial surfaces.
   * Wrapped in try/catch so a WebGPU-incompatible PMREMGenerator won't crash.
   */
  function setupEnvironmentMap(activeRenderer: any) {
    if (!activeRenderer) return;
    try {
      var pmrem = new THREE.PMREMGenerator(activeRenderer);
      pmrem.compileEquirectangularShader();
      var envTexture = pmrem.fromScene(new RoomEnvironment()).texture;
      scene.getScene().environment = envTexture;
      pmrem.dispose();
      needsUpdate = true;
    } catch (e) {
      console.warn('Environment map setup failed (may be expected for WebGPU):', e);
    }
  }

  function createRendererWithFallback() {
    const rendererOptions: any = {
      antialias: true,
      preserveDrawingBuffer: true
    };

    if (options.preferWebGPU && hasWebGPUSupport()) {
      try {
        const webgpuRenderer: any = new WebGPURenderer(rendererOptions);
        renderer = webgpuRenderer;
        rendererMode = 'webgpu';
        rendererReady = false;
        configureRendererDefaults(renderer);
        const initResult = typeof webgpuRenderer.init === 'function' ? webgpuRenderer.init() : null;
        Promise.resolve(initResult).then(() => {
          rendererReady = true;
          setupEnvironmentMap(renderer);
          needsUpdate = true;
        }).catch((error) => {
          console.error('WebGPU renderer initialization failed in main thread, switching to WebGL.', error);
          const previousCanvas = renderer?.domElement;
          renderer = new THREE.WebGLRenderer(rendererOptions);
          rendererMode = 'webgl';
          rendererReady = true;
          configureRendererDefaults(renderer);
          if (canvasElement) {
            renderer.domElement.id = canvasElement;
          }
          if (previousCanvas && previousCanvas.parentElement) {
            previousCanvas.parentElement.replaceChild(renderer.domElement, previousCanvas);
          } else if (domElement && renderer.domElement.parentElement !== domElement) {
            domElement.appendChild(renderer.domElement);
          }
          scope.updateWindowSize();
          if ((model.scene as any).setMaterialMode) {
            (model.scene as any).setMaterialMode('classic');
          }
          setupEnvironmentMap(renderer);
          needsUpdate = true;
        });
      } catch (error) {
        console.warn('WebGPU renderer creation failed in main thread, using WebGL fallback.', error);
      }
    }

    if (!renderer) {
      renderer = new THREE.WebGLRenderer(rendererOptions);
      rendererMode = 'webgl';
      rendererReady = true;
      configureRendererDefaults(renderer);
      // Synchronous WebGL path – environment map can be set up immediately
      setupEnvironmentMap(renderer);
    }

    if (canvasElement) {
      renderer.domElement.id = canvasElement;
    }
    if ((model.scene as any).setMaterialMode) {
      (model.scene as any).setMaterialMode(rendererMode === 'webgpu' ? 'node' : 'classic');
    }
  }

  function init() {
    domElement = scope.element;
    camera = new THREE.PerspectiveCamera(45, 1, 1, 10000);
    if (options.renderEnabled) {
      createRendererWithFallback();
    }

    var skybox = new (Skybox as any)(scene);

    scope.controls = new (Controls as any)(camera, domElement);

    hud = new (HUD as any)(scope);

    controller = new (Controller as any)(
      scope, model, camera, domElement, scope.controls, hud);

    if (renderer) {
      domElement.appendChild(renderer.domElement);
    }

    scope.updateWindowSize();
    if (options.resize) {
      window.addEventListener('resize', scope.updateWindowSize);
    }

    scope.centerCamera();
    model.floorplan.fireOnUpdatedRooms(scope.centerCamera);

    var lights = new (Lights as any)(scene, model.floorplan);

    floorplan = new (ThreeFloorplan as any)(scene, model.floorplan, scope.controls);

    animate();

    domElement.addEventListener('mouseenter', function () {
      mouseOver = true;
    });
    domElement.addEventListener('mouseleave', function () {
      mouseOver = false;
    });
    domElement.addEventListener('click', function () {
      hasClicked = true;
    });
  }

  function spin() {
    if (options.spin && !mouseOver && !hasClicked) {
      var theta = 2 * Math.PI * options.spinSpeed * (Date.now() - lastRender);
      scope.controls.rotateLeft(theta);
      scope.controls.update();
    }
  }

  this.dataUrl = function () {
    if (!renderer) {
      return '';
    }
    return renderer.domElement.toDataURL("image/png");
  };

  this.stopSpin = function () {
    hasClicked = true;
  };

  this.options = function () {
    return options;
  };

  this.getModel = function () {
    return model;
  };

  this.getScene = function () {
    return scene;
  };

  this.getController = function () {
    return controller;
  };

  this.getCamera = function () {
    return camera;
  };

  this.needsUpdate = function () {
    needsUpdate = true;
  };

  function shouldRender() {
    if (scope.controls.needsUpdate || controller.needsUpdate || needsUpdate || model.scene.needsUpdate) {
      scope.controls.needsUpdate = false;
      controller.needsUpdate = false;
      needsUpdate = false;
      model.scene.needsUpdate = false;
      return true;
    } else {
      return false;
    }
  }

  function render() {
    spin();
    if (renderer && rendererReady && shouldRender()) {
      renderer.clear();
      renderer.render(scene.getScene(), camera);
      renderer.clearDepth();
      renderer.render(hud.getScene(), camera);
    } else {
      shouldRender();
    }
    lastRender = Date.now();
  }

  function animate() {
    // var delay = 50;
    // setTimeout(function () {
    requestAnimationFrame(animate);
    // }, delay);
    render();
  }

  this.rotatePressed = function () {
    controller.rotatePressed();
  };

  this.rotateReleased = function () {
    controller.rotateReleased();
  };

  this.setCursorStyle = function (cursorStyle) {
    domElement.style.cursor = cursorStyle;
  };

  this.updateWindowSize = function () {
    var bounds = scope.element.getBoundingClientRect();
    scope.heightMargin = bounds.top;
    scope.widthMargin = bounds.left;

    scope.elementWidth = scope.element.clientWidth;
    if (options.resize) {
      scope.elementHeight = window.innerHeight - scope.heightMargin;
    } else {
      scope.elementHeight = scope.element.clientHeight;
    }

    camera.aspect = scope.elementWidth / scope.elementHeight;
    camera.updateProjectionMatrix();

    if (renderer) {
      renderer.setSize(scope.elementWidth, scope.elementHeight);
    }
    needsUpdate = true;
  };

  this.centerCamera = function () {
    var yOffset = 150.0;

    var pan = model.floorplan.getCenter();
    pan.y = yOffset;

    scope.controls.target = pan;

    var distance = model.floorplan.getSize().z * 1.5;

    var offset = pan.clone().add(
      new THREE.Vector3(0, distance, distance));
    camera.position.copy(offset);

    scope.controls.update();
  };

  this.projectVector = function (vec3, ignoreMargin?) {
    ignoreMargin = ignoreMargin || false;

    var widthHalf = scope.elementWidth / 2;
    var heightHalf = scope.elementHeight / 2;

    var vector = new THREE.Vector3();
    vector.copy(vec3);
    vector.project(camera);

    var vec2 = new THREE.Vector2();
    vec2.x = (vector.x * widthHalf) + widthHalf;
    vec2.y = -(vector.y * heightHalf) + heightHalf;

    if (!ignoreMargin) {
      vec2.x += scope.widthMargin;
      vec2.y += scope.heightMargin;
    }

    return vec2;
  };

  init();
};
