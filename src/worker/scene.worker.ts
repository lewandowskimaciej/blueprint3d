import * as THREE from 'three';
import { Callbacks } from '../core/callbacks';
import { Model } from '../model/model';
import { Floorplan as ThreeFloorplan } from '../three/floorplan';
import { Lights } from '../three/lights';
import { Skybox } from '../three/skybox';
import type {
  CameraState,
  SceneCommand,
  Vector3Like,
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
  WorkerRequestPayloadMap,
  WorkerRequestType,
  WorkerResponsePayloadMap
} from './protocol';

class SerializedHistory {
  private snapshots: string[] = [];
  private pointer = -1;

  constructor(private readonly maxSnapshots: number) {}

  public push(snapshot: string) {
    if (!snapshot) {
      return;
    }
    if (this.pointer >= 0 && this.snapshots[this.pointer] === snapshot) {
      return;
    }

    if (this.pointer < this.snapshots.length - 1) {
      this.snapshots = this.snapshots.slice(0, this.pointer + 1);
    }
    this.snapshots.push(snapshot);

    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
    this.pointer = this.snapshots.length - 1;
  }

  public undo(): string | null {
    if (!this.canUndo()) {
      return null;
    }
    this.pointer -= 1;
    return this.snapshots[this.pointer];
  }

  public redo(): string | null {
    if (!this.canRedo()) {
      return null;
    }
    this.pointer += 1;
    return this.snapshots[this.pointer];
  }

  public canUndo(): boolean {
    return this.pointer > 0;
  }

  public canRedo(): boolean {
    return this.pointer >= 0 && this.pointer < this.snapshots.length - 1;
  }
}

class WorkerSceneRuntime {
  private model: Model = null;
  private camera: THREE.PerspectiveCamera = null;
  private renderer: THREE.WebGLRenderer = null;
  private controlsBridge: { object: THREE.PerspectiveCamera; cameraMovedCallbacks: Callbacks } = null;
  private floorplanView: any = null;
  private renderLoopHandle: number = null;
  private rendererMode: 'webgl' | 'webgpu' = 'webgl';
  private history = new SerializedHistory(250);

  private ensureInitialized() {
    if (!this.model || !this.camera || !this.renderer || !this.controlsBridge) {
      throw new Error('Worker scene runtime is not initialized.');
    }
  }

  public async init(payload: WorkerRequestPayloadMap['init']): Promise<WorkerResponsePayloadMap['init']> {
    this.disposeInternal();

    this.model = new Model(payload.textureDir);
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 10000);

    this.renderer = await this.createRenderer(payload.canvas);
    this.configureRendererDefaults(this.renderer);
    if ((this.model.scene as any).setMaterialMode) {
      (this.model.scene as any).setMaterialMode('classic');
    }

    this.controlsBridge = {
      object: this.camera,
      cameraMovedCallbacks: new Callbacks()
    };

    new (Skybox as any)(this.model.scene);
    new (Lights as any)(this.model.scene, this.model.floorplan);
    this.floorplanView = new (ThreeFloorplan as any)(this.model.scene, this.model.floorplan, this.controlsBridge);

    this.resize(payload.width, payload.height, payload.devicePixelRatio);

    if (payload.serialized) {
      this.loadSerialized(payload.serialized, true, true);
    } else {
      this.centerCamera();
    }

    this.startRenderLoop();
    return { ok: true };
  }

  public resize(width: number, height: number, devicePixelRatio: number): WorkerResponsePayloadMap['resize'] {
    this.ensureInitialized();
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));

    this.renderer.setPixelRatio(devicePixelRatio || 1);
    this.renderer.setSize(safeWidth, safeHeight, false);
    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
    this.model.scene.needsUpdate = true;
    return { ok: true };
  }

  public loadSerialized(
    serialized: string,
    recordHistory = true,
    centerCamera = false
  ): WorkerResponsePayloadMap['load_serialized'] {
    this.ensureInitialized();
    this.model.loadSerialized(serialized);
    if (centerCamera) {
      this.centerCamera();
    }
    if (recordHistory) {
      this.history.push(serialized);
    }
    this.model.scene.needsUpdate = true;
    return { ok: true };
  }

  public applyCamera(cameraState: CameraState): WorkerResponsePayloadMap['set_camera'] {
    this.ensureInitialized();
    this.camera.position.set(
      cameraState.position.x,
      cameraState.position.y,
      cameraState.position.z
    );
    this.camera.lookAt(
      new THREE.Vector3(
        cameraState.target.x,
        cameraState.target.y,
        cameraState.target.z
      )
    );
    this.controlsBridge.cameraMovedCallbacks.fire();
    this.model.scene.needsUpdate = true;
    return { ok: true };
  }

  public centerCamera(): WorkerResponsePayloadMap['center_camera'] {
    this.ensureInitialized();
    const yOffset = 150.0;
    const pan = this.model.floorplan.getCenter();
    pan.y = yOffset;
    const distance = this.model.floorplan.getSize().z * 1.5;
    const offset = pan.clone().add(new THREE.Vector3(0, distance, distance));
    this.camera.position.copy(offset);
    this.camera.lookAt(pan);
    this.controlsBridge.cameraMovedCallbacks.fire();
    this.model.scene.needsUpdate = true;
    return { ok: true };
  }

  public async applySceneCommand(
    command: SceneCommand,
    recordHistory = true
  ): Promise<WorkerResponsePayloadMap['apply_scene_command']> {
    this.ensureInitialized();
    await this.executeSceneCommand(command);
    if (recordHistory) {
      this.history.push(this.model.exportSerialized());
    }
    return { ok: true };
  }

  public async applySceneCommands(
    commands: SceneCommand[],
    recordHistory = true
  ): Promise<WorkerResponsePayloadMap['apply_scene_commands']> {
    this.ensureInitialized();
    for (const command of commands) {
      await this.executeSceneCommand(command);
    }
    if (recordHistory) {
      this.history.push(this.model.exportSerialized());
    }
    return { ok: true };
  }

  public exportSerialized(): WorkerResponsePayloadMap['export_serialized'] {
    this.ensureInitialized();
    return { serialized: this.model.exportSerialized() };
  }

  public getHistoryState(): WorkerResponsePayloadMap['get_history_state'] {
    return {
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo()
    };
  }

  public undo(): WorkerResponsePayloadMap['undo'] {
    this.ensureInitialized();
    const snapshot = this.history.undo();
    if (!snapshot) {
      return {
        ok: false,
        canUndo: this.history.canUndo(),
        canRedo: this.history.canRedo()
      };
    }
    this.loadSerialized(snapshot, false, false);
    return {
      ok: true,
      serialized: snapshot,
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo()
    };
  }

  public redo(): WorkerResponsePayloadMap['redo'] {
    this.ensureInitialized();
    const snapshot = this.history.redo();
    if (!snapshot) {
      return {
        ok: false,
        canUndo: this.history.canUndo(),
        canRedo: this.history.canRedo()
      };
    }
    this.loadSerialized(snapshot, false, false);
    return {
      ok: true,
      serialized: snapshot,
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo()
    };
  }

  public dispose(): WorkerResponsePayloadMap['dispose'] {
    this.disposeInternal();
    return { ok: true };
  }

  private disposeInternal() {
    if (this.renderLoopHandle != null) {
      clearInterval(this.renderLoopHandle);
      this.renderLoopHandle = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
    this.floorplanView = null;
    this.controlsBridge = null;
    this.camera = null;
    this.model = null;
    this.renderer = null;
    this.rendererMode = 'webgl';
  }

  private startRenderLoop() {
    if (this.renderLoopHandle != null) {
      clearInterval(this.renderLoopHandle);
    }
    this.renderLoopHandle = setInterval(() => {
      if (!this.renderer || !this.camera || !this.model) {
        return;
      }
      this.renderer.clear();
      this.renderer.render(this.model.scene.getScene(), this.camera);
    }, 16) as unknown as number;
  }

  private getItem(index: number): any {
    const items = this.model.scene.getItems();
    const item = items[index];
    if (!item) {
      throw new Error(`Item index out of range: ${index}`);
    }
    return item;
  }

  private addItemCommand(command: Extract<SceneCommand, { type: 'add_item' }>): Promise<void> {
    return new Promise((resolve, reject) => {
      const loadedCallbacks = (this.model.scene as any).itemLoadedCallbacks;
      const onLoaded = (item: any) => {
        loadedCallbacks.remove(onLoaded);
        if (!item) {
          reject(new Error(`Failed to load item model "${command.fileName}"`));
          return;
        }
        resolve();
      };
      loadedCallbacks.add(onLoaded);
      this.model.scene.addItem(
        command.itemType,
        command.fileName,
        command.metadata,
        command.position
          ? new THREE.Vector3(command.position.x, command.position.y, command.position.z)
          : null,
        typeof command.rotation === 'number' ? command.rotation : 0,
        command.scale
          ? new THREE.Vector3(command.scale.x, command.scale.y, command.scale.z)
          : null,
        !!command.fixed
      );
    });
  }

  private async executeSceneCommand(command: SceneCommand) {
    if (command.type === 'replace_serialized_state') {
      this.loadSerialized(command.serialized, false, false);
      return;
    }

    if (command.type === 'add_item') {
      await this.addItemCommand(command);
    } else if (command.type === 'remove_item') {
      const item = this.getItem(command.itemIndex);
      this.model.scene.removeItem(item);
    } else if (command.type === 'update_item_transform') {
      const item = this.getItem(command.itemIndex);
      if (command.position) {
        item.position.set(command.position.x, command.position.y, command.position.z);
      }
      if (typeof command.rotationY === 'number') {
        item.rotation.y = command.rotationY;
      }
      if (command.scale) {
        item.scale.set(command.scale.x, command.scale.y, command.scale.z);
      }
      if (Array.isArray(command.matrix) && command.matrix.length === 16) {
        item.matrix.fromArray(command.matrix);
        item.matrix.decompose(item.position, item.quaternion, item.scale);
      }
      item.updateMatrixWorld(true);
    } else if (command.type === 'update_item_material') {
      const item = this.getItem(command.itemIndex);
      const materials = Array.isArray(item.material) ? item.material : [item.material];
      materials.forEach((material: any) => {
        if (typeof command.color === 'number' && material.color) {
          material.color.setHex(command.color);
        }
        if (typeof command.emissive === 'number' && material.emissive) {
          material.emissive.setHex(command.emissive);
        }
        if (typeof command.opacity === 'number') {
          material.opacity = command.opacity;
        }
        if (typeof command.transparent === 'boolean') {
          material.transparent = command.transparent;
        }
        if (typeof command.metalness === 'number' && 'metalness' in material) {
          material.metalness = command.metalness;
        }
        if (typeof command.roughness === 'number' && 'roughness' in material) {
          material.roughness = command.roughness;
        }
        material.needsUpdate = true;
      });
    } else if (command.type === 'set_item_fixed') {
      const item = this.getItem(command.itemIndex);
      item.fixed = command.fixed;
    } else if (command.type === 'set_wall_texture') {
      const walls = this.model.floorplan.getWalls();
      const wall = walls[command.wallIndex];
      if (!wall) {
        throw new Error(`Wall index out of range: ${command.wallIndex}`);
      }
      const texture = {
        url: command.textureUrl,
        stretch: command.stretch,
        scale: command.scale
      };
      if (command.side === 'front') {
        wall.frontTexture = texture;
        if (wall.frontEdge) {
          wall.frontEdge.redrawCallbacks.fire();
        }
      } else {
        wall.backTexture = texture;
        if (wall.backEdge) {
          wall.backEdge.redrawCallbacks.fire();
        }
      }
    } else if (command.type === 'set_floor_texture') {
      const rooms = this.model.floorplan.getRooms();
      const room = rooms.find((candidate: any) => candidate.getUuid() === command.roomUuid);
      if (!room || typeof room.setTexture !== 'function') {
        throw new Error(`Room not found for UUID: ${command.roomUuid}`);
      }
      room.setTexture(command.textureUrl, false, command.scale);
    }

    this.model.scene.needsUpdate = true;
  }

  private configureRendererDefaults(targetRenderer: any) {
    targetRenderer.autoClear = false;
    targetRenderer.shadowMap.enabled = true;
    targetRenderer.shadowMap.type = THREE.VSMShadowMap;
    targetRenderer.outputColorSpace = THREE.SRGBColorSpace;
    targetRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    targetRenderer.toneMappingExposure = 1.05;
    if ('useLegacyLights' in targetRenderer) {
      targetRenderer.useLegacyLights = false;
    }
  }

  private async createRenderer(canvas: OffscreenCanvas): Promise<THREE.WebGLRenderer> {
    // Always use WebGL inside the worker.
    //
    // Attempting WebGPU in a worker and then falling back to WebGL on the
    // same OffscreenCanvas is unsafe: if WebGPU init fails, the browser
    // leaves the canvas in a broken state and any subsequent call to
    // transferToImageBitmap() (made internally by Three.js / WebGLRenderer)
    // throws "Cannot transfer an ImageBitmap from an OffscreenCanvas with no
    // context".  The main thread already has its own WebGPU→WebGL fallback
    // path, so the worker simply uses WebGL directly.
    this.rendererMode = 'webgl';
    return new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true
    });
  }
}

const runtime = new WorkerSceneRuntime();
const workerScope = self as any;
let requestChain: Promise<void> = Promise.resolve();

function post(message: WorkerOutgoingMessage) {
  workerScope.postMessage(message);
}

async function handleRequest<T extends WorkerRequestType>(
  requestId: number,
  type: T,
  payload: WorkerRequestPayloadMap[T]
): Promise<WorkerResponsePayloadMap[T]> {
  if (type === 'init') {
    return runtime.init(payload as WorkerRequestPayloadMap['init']) as Promise<WorkerResponsePayloadMap[T]>;
  }
  if (type === 'resize') {
    const resizePayload = payload as WorkerRequestPayloadMap['resize'];
    return runtime.resize(resizePayload.width, resizePayload.height, resizePayload.devicePixelRatio) as WorkerResponsePayloadMap[T];
  }
  if (type === 'load_serialized') {
    const loadPayload = payload as WorkerRequestPayloadMap['load_serialized'];
    return runtime.loadSerialized(loadPayload.serialized, loadPayload.recordHistory !== false, !!loadPayload.centerCamera) as WorkerResponsePayloadMap[T];
  }
  if (type === 'set_camera') {
    const cameraPayload = payload as WorkerRequestPayloadMap['set_camera'];
    return runtime.applyCamera(cameraPayload.camera) as WorkerResponsePayloadMap[T];
  }
  if (type === 'center_camera') {
    return runtime.centerCamera() as WorkerResponsePayloadMap[T];
  }
  if (type === 'apply_scene_command') {
    const commandPayload = payload as WorkerRequestPayloadMap['apply_scene_command'];
    return runtime.applySceneCommand(commandPayload.command, commandPayload.recordHistory !== false) as Promise<WorkerResponsePayloadMap[T]>;
  }
  if (type === 'apply_scene_commands') {
    const commandPayload = payload as WorkerRequestPayloadMap['apply_scene_commands'];
    return runtime.applySceneCommands(commandPayload.commands, commandPayload.recordHistory !== false) as Promise<WorkerResponsePayloadMap[T]>;
  }
  if (type === 'export_serialized') {
    return runtime.exportSerialized() as WorkerResponsePayloadMap[T];
  }
  if (type === 'get_history_state') {
    return runtime.getHistoryState() as WorkerResponsePayloadMap[T];
  }
  if (type === 'undo') {
    return runtime.undo() as WorkerResponsePayloadMap[T];
  }
  if (type === 'redo') {
    return runtime.redo() as WorkerResponsePayloadMap[T];
  }
  if (type === 'dispose') {
    return runtime.dispose() as WorkerResponsePayloadMap[T];
  }
  throw new Error(`Unsupported worker request type: ${String(type)}`);
}

workerScope.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  const data = event.data;
  if (!data || data.kind !== 'request') {
    return;
  }

  requestChain = requestChain.then(async () => {
    try {
      const responsePayload = await handleRequest(data.requestId, data.type as any, data.payload as any);
      post({
        kind: 'response',
        requestId: data.requestId,
        type: data.type as any,
        ok: true,
        payload: responsePayload as any
      });
    } catch (error: any) {
      const message = error && error.message ? error.message : String(error);
      const stack = error && error.stack ? String(error.stack) : '';
      post({
        kind: 'event',
        type: 'error',
        payload: { requestId: data.requestId, message, stack }
      });
      post({
        kind: 'response',
        requestId: data.requestId,
        ok: false,
        error: message
      });
    }
  });
};
