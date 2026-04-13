import {
  createApp,
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref
} from 'vue/dist/vue.esm-bundler.js';
import { Blueprint3d, floorplannerModes } from '../../src/main';
import { ITEMS_CATALOG, type CatalogItem } from './items-data';

type ViewState = 'DEFAULT' | 'FLOORPLAN' | 'SHOP';
type TexturePanel = 'none' | 'wall' | 'floor';

interface TextureOption {
  url: string;
  stretch: boolean;
  scale: number;
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

createApp({
  setup() {
    const blueprint3d = ref<Blueprint3d | null>(null);
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

    const selectedItemName = computed(() => selectedItem.value?.metadata?.itemName ?? '');

    const toNumber = (value: string) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const cmToIn = (cm: number) => cm / 2.54;
    const inToCm = (inches: number) => inches * 2.54;

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
    };

    const toggleSelectedItemFixed = () => {
      if (!selectedItem.value) return;
      selectedItem.value.setFixed(Boolean(selectedItemFixed.value));
    };

    const deleteSelectedItem = () => {
      if (!selectedItem.value) return;
      selectedItem.value.remove();
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
    };

    const zoomOut = (event: MouseEvent) => {
      event.preventDefault();
      const bp = blueprint3d.value;
      if (!bp) return;
      bp.three.controls.dollyOut(1.1);
      bp.three.controls.update();
    };

    const resetView = (event: MouseEvent) => {
      event.preventDefault();
      blueprint3d.value?.three.centerCamera();
    };

    const pan = (x: number, y: number, event: MouseEvent) => {
      event.preventDefault();
      const bp = blueprint3d.value;
      if (!bp) return;
      bp.three.controls.panXY(x, y);
    };

    const applyTexture = (texture: TextureOption, event: MouseEvent) => {
      event.preventDefault();
      if (!currentTextureTarget.value) return;
      currentTextureTarget.value.setTexture(texture.url, texture.stretch, texture.scale);
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

      bp.model.scene.addItem(item.type, item.model, metadata);
      setState('DEFAULT');
    };

    const newDesign = (event: MouseEvent) => {
      event.preventDefault();
      blueprint3d.value?.model.loadSerialized(DEFAULT_ROOM_SERIALIZED);
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

    onMounted(() => {
      const bp = new Blueprint3d({
        floorplannerElement: 'floorplanner-canvas',
        threeElement: '#viewer',
        threeCanvasElement: 'three-canvas',
        textureDir: 'models/textures/',
        widget: false
      });

      blueprint3d.value = bp;

      bp.three.itemSelectedCallbacks.add(onItemSelected);
      bp.three.itemUnselectedCallbacks.add(onItemUnselected);
      bp.three.wallClicked.add(onWallClicked);
      bp.three.floorClicked.add(onFloorClicked);
      bp.three.itemSelectedCallbacks.add(resetTextures);
      bp.three.nothingClicked.add(resetTextures);
      bp.floorplanner.getModeResetCallbacks().add((mode: number) => {
        floorplannerMode.value = mode;
        if (mode === floorplannerModes.DRAW) {
          nextTick(handleWindowResize);
        }
      });

      (bp.model.scene as any).itemLoadingCallbacks.add(onItemLoading);
      (bp.model.scene as any).itemLoadedCallbacks.add(onItemLoaded);

      window.addEventListener('resize', handleWindowResize);

      handleWindowResize();
      bp.three.updateWindowSize();
      bp.model.loadSerialized(DEFAULT_ROOM_SERIALIZED);
    });

    onBeforeUnmount(() => {
      window.removeEventListener('resize', handleWindowResize);

      const bp = blueprint3d.value;
      if (!bp) return;

      bp.three.itemSelectedCallbacks.remove(onItemSelected);
      bp.three.itemUnselectedCallbacks.remove(onItemUnselected);
      bp.three.wallClicked.remove(onWallClicked);
      bp.three.floorClicked.remove(onFloorClicked);
      bp.three.itemSelectedCallbacks.remove(resetTextures);
      bp.three.nothingClicked.remove(resetTextures);
      (bp.model.scene as any).itemLoadingCallbacks.remove(onItemLoading);
      (bp.model.scene as any).itemLoadedCallbacks.remove(onItemLoaded);
    });

    return {
      addCatalogItem,
      addItemsHeight,
      applyTexture,
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
      wallTextures: WALL_TEXTURES,
      zoomIn,
      zoomOut
    };
  }
}).mount('#app');
