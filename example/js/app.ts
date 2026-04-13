import {
  createApp,
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref
} from 'vue/dist/vue.esm-bundler.js';
import { Blueprint3d, floorplannerModes } from '../../src/main';
import type { CameraState, SceneCommand } from '../../src/worker/protocol';
import { ITEMS_CATALOG, type CatalogItem } from './items-data';
import { SceneHistory } from './scene-history';
import { SceneWorkerClient } from './scene-worker-client';

type ViewState = 'DEFAULT' | 'FLOORPLAN' | 'SHOP';
type TexturePanel = 'none' | 'wall' | 'floor';

interface TextureOption {
  url: string;
  stretch: boolean;
  scale: number;
}

interface WorkerBridge {
  enabled: () => boolean;
  applyCommand: (command: SceneCommand, recordHistory?: boolean) => Promise<void>;
  applyCommands: (commands: SceneCommand[], recordHistory?: boolean) => Promise<void>;
  exportSerialized: () => Promise<string>;
  syncFromMain: (recordHistory?: boolean) => void;
  getHistoryState: () => Promise<{ canUndo: boolean; canRedo: boolean } | null>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
}

declare global {
  interface Window {
    __BP3DWorkerBridge?: WorkerBridge;
  }
}

const DEFAULT_ROOM_SERIALIZED = '{"floorplan":{"corners":{"f90da5e3-9e0e-eba7-173d-eb0b071e838e":{"x":204.85099999999989,"y":289.052},"da026c08-d76a-a944-8e7b-096b752da9ed":{"x":672.2109999999999,"y":289.052},"4e3d65cb-54c0-0681-28bf-bddcc7bdb571":{"x":672.2109999999999,"y":-178.308},"71d4f128-ae80-3d58-9bd2-711c6ce6cdf2":{"x":204.85099999999989,"y":-178.308}},"walls":[{"corner1":"71d4f128-ae80-3d58-9bd2-711c6ce6cdf2","corner2":"f90da5e3-9e0e-eba7-173d-eb0b071e838e","frontTexture":{"url":"rooms/textures/wallmap.png","stretch":true,"scale":0},"backTexture":{"url":"rooms/textures/wallmap.png","stretch":true,"scale":0}},{"corner1":"f90da5e3-9e0e-eba7-173d-eb0b071e838e","corner2":"da026c08-d76a-a944-8e7b-096b752da9ed","frontTexture":{"url":"rooms/textures/wallmap.png","stretch":true,"scale":0},"backTexture":{"url":"rooms/textures/wallmap.png","stretch":true,"scale":0}},{"corner1":"da026c08-d76a-a944-8e7b-096b752da9ed","corner2":"4e3d65cb-54c0-0681-28bf-bddcc7bdb571","frontTexture":{"url":"rooms/textures/wallmap.png","stretch":true,"scale":0},"backTexture":{"url":"rooms/textures/wallmap.png","stretch":true,"scale":0}},{"corner1":"4e3d65cb-54c0-0681-28bf-bddcc7bdb571","corner2":"71d4f128-ae80-3d58-9bd2-711c6ce6cdf2","frontTexture":{"url":"rooms/textures/wallmap.png","stretch":true,"scale":0},"backTexture":{"url":"rooms/textures/wallmap.png","stretch":true,"scale":0}}],"wallTextures":[],"floorTextures":{},"newFloorTextures":{}},"items":[]}';

const WALL_TEXTURES: TextureOption[] = [
  { url: 'rooms/textures/marbletiles.jpg', stretch: false, scale: 300 },
  { url: 'rooms/textures/wallmap_yellow.png', stretch: true, scale: 0 },
  { url: 'rooms/textures/light_brick.jpg', stretch: false, scale: 100 }
];

const FLOOR_TEXTURES: TextureOption[] = [
  { url: 'rooms/textures/light_fine_wood.jpg', stretch: false, scale: 300 }
];

const PAN_SPEED = 30;
const SNAPSHOT_OBSERVER_INTERVAL_MS = 120;
const SNAPSHOT_SETTLE_MS = 240;

createApp({
  setup() {
    const blueprint3d = ref<Blueprint3d | null>(null);
    const workerRenderer = ref<SceneWorkerClient | null>(null);
    const workerRendererEnabled = ref(false);
    const currentState = ref<ViewState>('DEFAULT');
    const floorplannerMode = ref<number>(floorplannerModes.MOVE);
    const loadingItems = ref(0);
    const texturePanel = ref<TexturePanel>('none');
    const currentTextureTarget = ref<any>(null);
    const selectedItem = ref<any>(null);
    const selectedItemFixed = ref(false);
    const itemWidth = ref('');
    const itemDepth = ref('');
    const itemHeight = ref('');
    const sidebarHeight = ref(window.innerHeight);
    const addItemsHeight = ref(window.innerHeight);
    const floorplannerHeight = ref(window.innerHeight);
    const canUndo = ref(false);
    const canRedo = ref(false);

    const sceneHistory = new SceneHistory(300);

    let applyingHistory = false;
    let lastSnapshot = '';
    let workerSyncInFlight = false;
    let queuedWorkerSync: { serialized: string; recordHistory: boolean } | null = null;
    let cameraSyncQueued = false;
    let snapshotObserverHandle: number | null = null;
    let pendingObservedSnapshot: string | null = null;
    let pendingObservedSnapshotSince = 0;

    const selectedItemName = computed(() => selectedItem.value?.metadata?.itemName ?? '');

    const toNumber = (value: string) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const cmToIn = (cm: number) => cm / 2.54;
    const inToCm = (inches: number) => inches * 2.54;

    const supportsOffscreenRenderer = () => {
      const hasWorker = typeof Worker !== 'undefined';
      const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
      const hasCanvasTransfer =
        typeof HTMLCanvasElement !== 'undefined' &&
        typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
      return hasWorker && hasOffscreen && hasCanvasTransfer;
    };

    const getCameraState = (bp: Blueprint3d): CameraState => {
      const camera = bp.three.getCamera();
      const target = bp.three.controls.target;
      return {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: target.x, y: target.y, z: target.z }
      };
    };

    const getItemIndex = (item: any): number => {
      const bp = blueprint3d.value;
      if (!bp || !item) {
        return -1;
      }
      return bp.model.scene.getItems().indexOf(item);
    };

    const updateUndoRedoFlags = (forceCanUndo?: boolean, forceCanRedo?: boolean) => {
      if (typeof forceCanUndo === 'boolean' && typeof forceCanRedo === 'boolean') {
        canUndo.value = forceCanUndo;
        canRedo.value = forceCanRedo;
        return;
      }
      canUndo.value = sceneHistory.canUndo();
      canRedo.value = sceneHistory.canRedo();
    };

    const clearPendingObservedSnapshot = () => {
      pendingObservedSnapshot = null;
      pendingObservedSnapshotSince = 0;
    };

    const recordLocalFallbackSnapshot = (force = false) => {
      if (workerRendererEnabled.value || applyingHistory) {
        return;
      }
      const bp = blueprint3d.value;
      if (!bp) {
        return;
      }
      const serialized = bp.model.exportSerialized();
      if (!force && serialized === lastSnapshot) {
        return;
      }
      lastSnapshot = serialized;
      sceneHistory.push(serialized);
      updateUndoRedoFlags();
    };

    const applySnapshotToMain = (serialized: string) => {
      const bp = blueprint3d.value;
      if (!bp) {
        return;
      }
      applyingHistory = true;
      bp.model.loadSerialized(serialized);
      selectedItem.value = null;
      selectedItemFixed.value = false;
      currentTextureTarget.value = null;
      texturePanel.value = 'none';
      lastSnapshot = serialized;
      clearPendingObservedSnapshot();
      applyingHistory = false;
    };

    const refreshWorkerHistoryState = async () => {
      if (!workerRendererEnabled.value || !workerRenderer.value) {
        return;
      }
      try {
        const historyState = await workerRenderer.value.getHistoryState();
        updateUndoRedoFlags(historyState.canUndo, historyState.canRedo);
      } catch (error) {
        console.error('Failed to refresh worker history state', error);
      }
    };

    const flushWorkerSerializedSync = async () => {
      if (!workerRendererEnabled.value || !workerRenderer.value || workerSyncInFlight || !queuedWorkerSync) {
        return;
      }
      workerSyncInFlight = true;
      const pending = queuedWorkerSync;
      queuedWorkerSync = null;
      try {
        await workerRenderer.value.loadSerialized(pending.serialized, pending.recordHistory, false);
        lastSnapshot = pending.serialized;
        await refreshWorkerHistoryState();
      } catch (error) {
        console.error('Worker serialized sync failed', error);
        if (!queuedWorkerSync) {
          queuedWorkerSync = pending;
        }
      } finally {
        workerSyncInFlight = false;
      }
      if (queuedWorkerSync) {
        void flushWorkerSerializedSync();
      }
    };

    const queueWorkerSerializedSync = (serialized: string, recordHistory: boolean) => {
      if (!workerRendererEnabled.value || !workerRenderer.value) {
        return;
      }
      queuedWorkerSync = { serialized, recordHistory };
      void flushWorkerSerializedSync();
    };

    const syncWorkerWithFullState = (recordHistory = true) => {
      if (!workerRendererEnabled.value || !workerRenderer.value) {
        recordLocalFallbackSnapshot(recordHistory);
        return;
      }
      const bp = blueprint3d.value;
      if (!bp) {
        return;
      }
      const serialized = bp.model.exportSerialized();
      queueWorkerSerializedSync(serialized, recordHistory);
    };

    const sendWorkerSceneCommand = async (command: SceneCommand, recordHistory = true) => {
      if (!workerRendererEnabled.value || !workerRenderer.value) {
        recordLocalFallbackSnapshot(recordHistory);
        return;
      }
      try {
        await workerRenderer.value.applySceneCommand(command, recordHistory);
        await refreshWorkerHistoryState();
      } catch (error) {
        console.error('Worker scene command failed', command, error);
        syncWorkerWithFullState(recordHistory);
      }
    };

    const sendWorkerSceneCommands = async (commands: SceneCommand[], recordHistory = true) => {
      if (!workerRendererEnabled.value || !workerRenderer.value) {
        recordLocalFallbackSnapshot(recordHistory);
        return;
      }
      try {
        await workerRenderer.value.applySceneCommands(commands, recordHistory);
        await refreshWorkerHistoryState();
      } catch (error) {
        console.error('Worker scene commands failed', commands, error);
        syncWorkerWithFullState(recordHistory);
      }
    };

    const observeCurrentSnapshot = (forceCommit = false) => {
      if (applyingHistory) {
        return;
      }
      const bp = blueprint3d.value;
      if (!bp) {
        return;
      }

      const serialized = bp.model.exportSerialized();
      if (!serialized || serialized === lastSnapshot) {
        clearPendingObservedSnapshot();
        return;
      }

      if (forceCommit) {
        clearPendingObservedSnapshot();
        if (workerRendererEnabled.value && workerRenderer.value) {
          queueWorkerSerializedSync(serialized, true);
        } else {
          lastSnapshot = serialized;
          sceneHistory.push(serialized);
          updateUndoRedoFlags();
        }
        return;
      }

      const now = Date.now();
      if (pendingObservedSnapshot !== serialized) {
        pendingObservedSnapshot = serialized;
        pendingObservedSnapshotSince = now;
        return;
      }

      if (now - pendingObservedSnapshotSince >= SNAPSHOT_SETTLE_MS) {
        clearPendingObservedSnapshot();
        if (workerRendererEnabled.value && workerRenderer.value) {
          queueWorkerSerializedSync(serialized, true);
        } else {
          lastSnapshot = serialized;
          sceneHistory.push(serialized);
          updateUndoRedoFlags();
        }
      }
    };

    const scheduleCameraSync = () => {
      if (!workerRendererEnabled.value || !workerRenderer.value || !blueprint3d.value) {
        return;
      }
      if (cameraSyncQueued) {
        return;
      }
      cameraSyncQueued = true;
      requestAnimationFrame(() => {
        cameraSyncQueued = false;
        if (!workerRendererEnabled.value || !workerRenderer.value || !blueprint3d.value) {
          return;
        }
        void workerRenderer.value.setCamera(getCameraState(blueprint3d.value)).catch((error) => {
          console.error('Worker camera sync failed', error);
        });
      });
    };

    const buildItemTransformCommand = (item: any, itemIndex: number): SceneCommand => {
      return {
        type: 'update_item_transform',
        itemIndex,
        position: {
          x: item.position.x,
          y: item.position.y,
          z: item.position.z
        },
        rotationY: item.rotation.y,
        scale: {
          x: item.scale.x,
          y: item.scale.y,
          z: item.scale.z
        }
      };
    };

    const resetTextures = () => {
      currentTextureTarget.value = null;
      texturePanel.value = 'none';
    };

    const updateSelectedDimensions = () => {
      if (!selectedItem.value) {
        itemWidth.value = '';
        itemDepth.value = '';
        itemHeight.value = '';
        return;
      }
      itemWidth.value = cmToIn(selectedItem.value.getWidth()).toFixed(0);
      itemDepth.value = cmToIn(selectedItem.value.getDepth()).toFixed(0);
      itemHeight.value = cmToIn(selectedItem.value.getHeight()).toFixed(0);
    };

    const resizeSelectedItem = () => {
      if (!selectedItem.value) return;
      selectedItem.value.resize(
        inToCm(toNumber(itemHeight.value)),
        inToCm(toNumber(itemWidth.value)),
        inToCm(toNumber(itemDepth.value))
      );
      const itemIndex = getItemIndex(selectedItem.value);
      if (itemIndex >= 0) {
        void sendWorkerSceneCommand(buildItemTransformCommand(selectedItem.value, itemIndex), true);
      } else {
        syncWorkerWithFullState(true);
      }
      recordLocalFallbackSnapshot(true);
    };

    const toggleSelectedItemFixed = () => {
      if (!selectedItem.value) return;
      selectedItem.value.setFixed(Boolean(selectedItemFixed.value));
      const itemIndex = getItemIndex(selectedItem.value);
      if (itemIndex >= 0) {
        void sendWorkerSceneCommand({
          type: 'set_item_fixed',
          itemIndex,
          fixed: Boolean(selectedItemFixed.value)
        }, true);
      } else {
        syncWorkerWithFullState(true);
      }
      recordLocalFallbackSnapshot(true);
    };

    const deleteSelectedItem = () => {
      if (!selectedItem.value) return;
      const itemIndex = getItemIndex(selectedItem.value);
      selectedItem.value.remove();
      if (itemIndex >= 0) {
        void sendWorkerSceneCommand({
          type: 'remove_item',
          itemIndex
        }, true);
      } else {
        syncWorkerWithFullState(true);
      }
      recordLocalFallbackSnapshot(true);
    };

    const onItemSelected = (item: any) => {
      selectedItem.value = item;
      selectedItemFixed.value = Boolean(item.fixed);
      updateSelectedDimensions();
      resetTextures();
    };

    const onItemUnselected = () => {
      selectedItem.value = null;
      selectedItemFixed.value = false;
      updateSelectedDimensions();
    };

    const onItemLoading = () => {
      loadingItems.value += 1;
    };

    const onItemLoaded = () => {
      loadingItems.value = Math.max(loadingItems.value - 1, 0);
      recordLocalFallbackSnapshot();
    };

    const onItemTransformCompleted = (item: any) => {
      const itemIndex = getItemIndex(item);
      if (itemIndex >= 0) {
        void sendWorkerSceneCommand(buildItemTransformCommand(item, itemIndex), true);
      } else {
        syncWorkerWithFullState(true);
      }
      recordLocalFallbackSnapshot(true);
    };

    const onFloorplanEditCompleted = () => {
      if (applyingHistory) {
        return;
      }
      syncWorkerWithFullState(true);
      recordLocalFallbackSnapshot(true);
    };

    const onWallClicked = (halfEdge: any) => {
      currentTextureTarget.value = halfEdge;
      texturePanel.value = 'wall';
    };

    const onFloorClicked = (room: any) => {
      currentTextureTarget.value = room;
      texturePanel.value = 'floor';
    };

    const setState = (newState: ViewState) => {
      const bp = blueprint3d.value;
      if (!bp || currentState.value === newState) return;

      bp.three.getController().setSelectedObject(null);
      const previousState = currentState.value;
      if (previousState === 'FLOORPLAN') {
        bp.model.floorplan.update();
      }

      currentState.value = newState;
      resetTextures();

      nextTick(() => {
        if (!blueprint3d.value) return;
        if (newState === 'FLOORPLAN') {
          blueprint3d.value.floorplanner.reset();
        }
        handleWindowResize();
        if (newState === 'DEFAULT') {
          blueprint3d.value.three.updateWindowSize();
        }
      });
    };

    const selectState = (newState: ViewState) => {
      const bp = blueprint3d.value;
      if (bp) {
        bp.three.stopSpin();
      }
      setState(newState);
    };

    const handleWindowResize = () => {
      sidebarHeight.value = window.innerHeight;
      addItemsHeight.value = window.innerHeight;

      const floorplannerElement = document.getElementById('floorplanner');
      if (floorplannerElement) {
        floorplannerHeight.value = Math.max(
          0,
          window.innerHeight - floorplannerElement.getBoundingClientRect().top
        );
      }

      const bp = blueprint3d.value;
      if (!bp) return;

      if (currentState.value === 'FLOORPLAN') {
        bp.floorplanner.resizeView();
      }

      bp.three.updateWindowSize();

      if (currentState.value === 'DEFAULT' && workerRendererEnabled.value && workerRenderer.value) {
        const viewer = document.getElementById('viewer');
        if (viewer) {
          const bounds = viewer.getBoundingClientRect();
          const widthSource = bounds.width > 1 ? bounds.width : window.innerWidth;
          const heightSource = bounds.height > 1 ? bounds.height : window.innerHeight;
          void workerRenderer.value.resize({
            width: Math.max(1, Math.floor(widthSource)),
            height: Math.max(1, Math.floor(heightSource)),
            devicePixelRatio: window.devicePixelRatio || 1
          }).catch((error) => {
            console.error('Worker resize failed', error);
          });
          scheduleCameraSync();
        }
      }
    };

    const setFloorplannerMode = (mode: number) => {
      const bp = blueprint3d.value;
      if (!bp) return;
      bp.floorplanner.setMode(mode);
    };

    const zoomIn = (event: MouseEvent) => {
      event.preventDefault();
      const bp = blueprint3d.value;
      if (!bp) return;
      bp.three.controls.dollyIn(1.1);
      bp.three.controls.update();
      scheduleCameraSync();
    };

    const zoomOut = (event: MouseEvent) => {
      event.preventDefault();
      const bp = blueprint3d.value;
      if (!bp) return;
      bp.three.controls.dollyOut(1.1);
      bp.three.controls.update();
      scheduleCameraSync();
    };

    const resetView = (event: MouseEvent) => {
      event.preventDefault();
      const bp = blueprint3d.value;
      if (!bp) return;
      bp.three.centerCamera();
      scheduleCameraSync();
    };

    const pan = (x: number, y: number, event: MouseEvent) => {
      event.preventDefault();
      const bp = blueprint3d.value;
      if (!bp) return;
      bp.three.controls.panXY(x, y);
      scheduleCameraSync();
    };

    const performUndo = async (): Promise<boolean> => {
      const bp = blueprint3d.value;
      if (!bp) return false;

      observeCurrentSnapshot(true);

      if (workerRendererEnabled.value && workerRenderer.value) {
        try {
          await flushWorkerSerializedSync();
          const response = await workerRenderer.value.undo();
          if (response.ok && response.serialized) {
            applySnapshotToMain(response.serialized);
            scheduleCameraSync();
          }
          updateUndoRedoFlags(response.canUndo, response.canRedo);
          return response.ok;
        } catch (error) {
          console.error('Worker undo failed', error);
        }
        return false;
      }

      const snapshot = sceneHistory.undo(bp.model.exportSerialized());
      if (!snapshot) return false;
      applySnapshotToMain(snapshot);
      updateUndoRedoFlags();
      return true;
    };

    const performRedo = async (): Promise<boolean> => {
      const bp = blueprint3d.value;
      if (!bp) return false;

      observeCurrentSnapshot(true);

      if (workerRendererEnabled.value && workerRenderer.value) {
        try {
          await flushWorkerSerializedSync();
          const response = await workerRenderer.value.redo();
          if (response.ok && response.serialized) {
            applySnapshotToMain(response.serialized);
            scheduleCameraSync();
          }
          updateUndoRedoFlags(response.canUndo, response.canRedo);
          return response.ok;
        } catch (error) {
          console.error('Worker redo failed', error);
        }
        return false;
      }

      const snapshot = sceneHistory.redo();
      if (!snapshot) return false;
      applySnapshotToMain(snapshot);
      updateUndoRedoFlags();
      return true;
    };

    const undoChange = async (event: MouseEvent) => {
      event.preventDefault();
      await performUndo();
    };

    const redoChange = async (event: MouseEvent) => {
      event.preventDefault();
      await performRedo();
    };

    const applyTexture = (texture: TextureOption, event: MouseEvent) => {
      event.preventDefault();
      const bp = blueprint3d.value;
      if (!bp || !currentTextureTarget.value) return;

      const target = currentTextureTarget.value;
      if (typeof target.setTexture !== 'function') {
        console.error('Current texture target does not support setTexture()', target);
        return;
      }
      target.setTexture(texture.url, texture.stretch, texture.scale);

      if (target.wall) {
        const wallIndex = bp.model.floorplan.getWalls().indexOf(target.wall);
        const side = target.wall.frontEdge === target ? 'front' : 'back';
        if (wallIndex >= 0) {
          void sendWorkerSceneCommand({
            type: 'set_wall_texture',
            wallIndex,
            side,
            textureUrl: texture.url,
            stretch: texture.stretch,
            scale: texture.scale
          }, true);
        } else {
          syncWorkerWithFullState(true);
        }
      } else if (typeof target.getUuid === 'function') {
        void sendWorkerSceneCommand({
          type: 'set_floor_texture',
          roomUuid: target.getUuid(),
          textureUrl: texture.url,
          scale: texture.scale
        }, true);
      } else {
        syncWorkerWithFullState(true);
      }

      recordLocalFallbackSnapshot(true);
    };

    const addCatalogItem = (item: CatalogItem, event: MouseEvent) => {
      event.preventDefault();
      const bp = blueprint3d.value;
      if (!bp) return;

      const metadata = {
        itemName: item.name,
        resizable: true,
        modelUrl: item.model,
        itemType: item.type
      };

      const command: SceneCommand = {
        type: 'add_item',
        itemType: item.type,
        fileName: item.model,
        metadata,
        position: null
      };

      bp.model.scene.addItem(item.type, item.model, metadata);
      void sendWorkerSceneCommand(command, true);
      setState('DEFAULT');
    };

    const newDesign = (event: MouseEvent) => {
      event.preventDefault();
      const bp = blueprint3d.value;
      if (!bp) return;
      bp.model.loadSerialized(DEFAULT_ROOM_SERIALIZED);
      lastSnapshot = DEFAULT_ROOM_SERIALIZED;
      void sendWorkerSceneCommand({
        type: 'replace_serialized_state',
        serialized: DEFAULT_ROOM_SERIALIZED
      }, true);
      recordLocalFallbackSnapshot(true);
    };

    const loadDesign = (event: Event) => {
      const bp = blueprint3d.value;
      if (!bp) return;

      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        const data = String(readerEvent.target?.result ?? '');
        bp.model.loadSerialized(data);
        lastSnapshot = data;
        void sendWorkerSceneCommand({
          type: 'replace_serialized_state',
          serialized: data
        }, true);
        recordLocalFallbackSnapshot(true);
      };
      reader.readAsText(file);
      input.value = '';
    };

    const saveDesign = (event: MouseEvent) => {
      event.preventDefault();
      const bp = blueprint3d.value;
      if (!bp) return;

      const data = bp.model.exportSerialized();
      const link = document.createElement('a');
      const blob = new Blob([data], { type: 'text/plain' });
      link.href = window.URL.createObjectURL(blob);
      link.download = 'design.blueprint3d';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(link.href);
    };

    onMounted(async () => {
      const workerCanvas = document.getElementById('worker-three-canvas') as HTMLCanvasElement | null;
      const threadedQuery = new URLSearchParams(window.location.search).get('threaded');
      const shouldUseWorkerRenderer =
        supportsOffscreenRenderer() &&
        !!workerCanvas &&
        threadedQuery !== '0';

      const bp = new Blueprint3d({
        floorplannerElement: 'floorplanner-canvas',
        threeElement: '#viewer',
        threeCanvasElement: 'three-canvas',
        textureDir: 'models/textures/',
        widget: false,
        useMainRenderer: !shouldUseWorkerRenderer
      });

      blueprint3d.value = bp;

      const controller = bp.three.getController();

      bp.three.itemSelectedCallbacks.add(onItemSelected);
      bp.three.itemUnselectedCallbacks.add(onItemUnselected);
      bp.three.wallClicked.add(onWallClicked);
      bp.three.floorClicked.add(onFloorClicked);
      bp.three.itemSelectedCallbacks.add(resetTextures);
      bp.three.nothingClicked.add(resetTextures);
      bp.three.controls.cameraMovedCallbacks.add(scheduleCameraSync);
      controller.itemTransformCompletedCallbacks.add(onItemTransformCompleted);

      bp.floorplanner.getModeResetCallbacks().add((mode: number) => {
        floorplannerMode.value = mode;
        if (mode === floorplannerModes.DRAW) {
          nextTick(handleWindowResize);
        }
      });
      bp.floorplanner.getChangeCallbacks().add(onFloorplanEditCompleted);

      (bp.model.scene as any).itemLoadingCallbacks.add(onItemLoading);
      (bp.model.scene as any).itemLoadedCallbacks.add(onItemLoaded);
      (bp.model.scene as any).itemRemovedCallbacks.add(recordLocalFallbackSnapshot);

      window.addEventListener('resize', handleWindowResize);
      snapshotObserverHandle = window.setInterval(() => {
        observeCurrentSnapshot(false);
      }, SNAPSHOT_OBSERVER_INTERVAL_MS);

      handleWindowResize();
      bp.model.loadSerialized(DEFAULT_ROOM_SERIALIZED);
      lastSnapshot = bp.model.exportSerialized();
      sceneHistory.push(lastSnapshot);
      updateUndoRedoFlags();

      if (shouldUseWorkerRenderer && workerCanvas) {
        workerCanvas.style.display = 'block';
        const worker = new SceneWorkerClient();
        workerRenderer.value = worker;
        const offscreen = workerCanvas.transferControlToOffscreen();
        const viewer = document.getElementById('viewer');
        const bounds = viewer ? viewer.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
        const widthSource = bounds.width > 1 ? bounds.width : window.innerWidth;
        const heightSource = bounds.height > 1 ? bounds.height : window.innerHeight;
        try {
          await worker.init({
            canvas: offscreen,
            width: Math.max(1, Math.floor(widthSource)),
            height: Math.max(1, Math.floor(heightSource)),
            devicePixelRatio: window.devicePixelRatio || 1,
            textureDir: 'models/textures/',
            serialized: lastSnapshot
          });
          workerRendererEnabled.value = true;
          await refreshWorkerHistoryState();
          scheduleCameraSync();
        } catch (error) {
          console.error('Failed to initialize scene worker renderer, falling back to main renderer.', error);
          workerRendererEnabled.value = false;
          await worker.dispose();
          workerRenderer.value = null;
          updateUndoRedoFlags();
        }
      } else if (workerCanvas) {
        workerCanvas.style.display = 'none';
      }

      window.__BP3DWorkerBridge = {
        enabled: () => workerRendererEnabled.value && !!workerRenderer.value,
        applyCommand: async (command: SceneCommand, recordHistory = true) => {
          await sendWorkerSceneCommand(command, recordHistory);
          if (workerRendererEnabled.value && workerRenderer.value) {
            const response = await workerRenderer.value.exportSerialized();
            applySnapshotToMain(response.serialized);
          }
        },
        applyCommands: async (commands: SceneCommand[], recordHistory = true) => {
          await sendWorkerSceneCommands(commands, recordHistory);
          if (workerRendererEnabled.value && workerRenderer.value) {
            const response = await workerRenderer.value.exportSerialized();
            applySnapshotToMain(response.serialized);
          }
        },
        exportSerialized: async () => {
          if (workerRendererEnabled.value && workerRenderer.value) {
            const response = await workerRenderer.value.exportSerialized();
            return response.serialized;
          }
          const localBp = blueprint3d.value;
          return localBp ? localBp.model.exportSerialized() : '';
        },
        syncFromMain: (recordHistory = true) => {
          syncWorkerWithFullState(recordHistory);
          observeCurrentSnapshot(true);
        },
        getHistoryState: async () => {
          if (!workerRendererEnabled.value || !workerRenderer.value) {
            return null;
          }
          return workerRenderer.value.getHistoryState();
        },
        undo: async () => performUndo(),
        redo: async () => performRedo()
      };
    });

    onBeforeUnmount(() => {
      window.removeEventListener('resize', handleWindowResize);
      delete window.__BP3DWorkerBridge;
      if (snapshotObserverHandle != null) {
        window.clearInterval(snapshotObserverHandle);
        snapshotObserverHandle = null;
      }

      const bp = blueprint3d.value;
      if (bp) {
        const controller = bp.three.getController();
        bp.three.itemSelectedCallbacks.remove(onItemSelected);
        bp.three.itemUnselectedCallbacks.remove(onItemUnselected);
        bp.three.wallClicked.remove(onWallClicked);
        bp.three.floorClicked.remove(onFloorClicked);
        bp.three.itemSelectedCallbacks.remove(resetTextures);
        bp.three.nothingClicked.remove(resetTextures);
        bp.three.controls.cameraMovedCallbacks.remove(scheduleCameraSync);
        controller.itemTransformCompletedCallbacks.remove(onItemTransformCompleted);
        bp.floorplanner.getChangeCallbacks().remove(onFloorplanEditCompleted);
        (bp.model.scene as any).itemLoadingCallbacks.remove(onItemLoading);
        (bp.model.scene as any).itemLoadedCallbacks.remove(onItemLoaded);
        (bp.model.scene as any).itemRemovedCallbacks.remove(recordLocalFallbackSnapshot);
      }

      if (workerRenderer.value) {
        void workerRenderer.value.dispose();
        workerRenderer.value = null;
      }
      workerRendererEnabled.value = false;
    });

    return {
      addCatalogItem,
      addItemsHeight,
      applyTexture,
      canRedo,
      canUndo,
      currentState,
      deleteSelectedItem,
      floorplannerHeight,
      floorplannerMode,
      floorplannerModes,
      floorTextures: FLOOR_TEXTURES,
      itemDepth,
      itemHeight,
      itemWidth,
      itemsCatalog: ITEMS_CATALOG,
      loadingItems,
      newDesign,
      loadDesign,
      panDown: (event: MouseEvent) => pan(0, -PAN_SPEED, event),
      panLeft: (event: MouseEvent) => pan(PAN_SPEED, 0, event),
      panRight: (event: MouseEvent) => pan(-PAN_SPEED, 0, event),
      panUp: (event: MouseEvent) => pan(0, PAN_SPEED, event),
      resetView,
      redoChange,
      resizeSelectedItem,
      saveDesign,
      selectState,
      selectedItem,
      selectedItemFixed,
      selectedItemName,
      setFloorplannerMode,
      sidebarHeight,
      texturePanel,
      toggleSelectedItemFixed,
      undoChange,
      wallTextures: WALL_TEXTURES,
      zoomIn,
      zoomOut
    };
  }
}).mount('#app');
