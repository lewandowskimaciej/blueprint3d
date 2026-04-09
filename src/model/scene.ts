import * as THREE from 'three';
import $ from 'jquery';
import { Utils } from '../core/utils';
import { Floorplan } from './floorplan';

/**
 * The Scene is a manager of Items and also links to a ThreeJS scene.
 */
export class Scene {

  /** The associated ThreeJS scene. */
  private threeScene: THREE.Scene;

  /** */
  private items: any[] = [];

  /** */
  public needsUpdate = false;

  /** */
  private itemLoadingCallbacks = ($ as any).Callbacks();

  /** Item */
  public itemLoadedCallbacks = ($ as any).Callbacks();

  /** Item */
  public itemRemovedCallbacks = ($ as any).Callbacks();

  /**
   * Constructs a scene.
   * @param model The associated model.
   * @param textureDir The directory from which to load the textures.
   */
  constructor(private model: any, private textureDir: string) {
    this.threeScene = new THREE.Scene();
  }

  /** Adds a non-item, basically a mesh, to the scene. */
  public add(mesh: THREE.Mesh) {
    this.threeScene.add(mesh);
  }

  /** Removes a non-item, basically a mesh, from the scene. */
  public remove(mesh: THREE.Mesh) {
    this.threeScene.remove(mesh);
    Utils.removeValue(this.items, mesh);
  }

  /** Gets the THREE.Scene. */
  public getScene(): THREE.Scene {
    return this.threeScene;
  }

  /** Gets the items. */
  public getItems(): any[] {
    return this.items;
  }

  /** Gets the count of items. */
  public itemCount(): number {
    return this.items.length;
  }

  /** Removes all items. */
  public clearItems() {
    var scope = this;
    this.items.forEach((item) => {
      scope.removeItem(item, true);
    });
    this.items = [];
  }

  /**
   * Removes an item.
   * @param item The item to be removed.
   * @param dontRemove If not set, also remove the item from the items list.
   */
  public removeItem(item: any, dontRemove?: boolean) {
    dontRemove = dontRemove || false;
    this.itemRemovedCallbacks.fire(item);
    item.removed();
    this.threeScene.remove(item);
    if (!dontRemove) {
      Utils.removeValue(this.items, item);
    }
  }

  /**
   * Creates an item and adds it to the scene.
   * @param itemType The type of the item given by an enumerator.
   * @param fileName The name of the file to load.
   * @param metadata TODO
   * @param position The initial position.
   * @param rotation The initial rotation around the y axis.
   * @param scale The initial scaling.
   * @param fixed True if fixed.
   */
  public addItem(itemType: number, fileName: string, metadata: any, position: THREE.Vector3, rotation: number, scale: THREE.Vector3, fixed: boolean) {
    itemType = itemType || 1;
    var scope = this;

    // Dynamically import Factory to avoid circular deps at module load time
    import('../items/factory').then(({ Factory }) => {
      var loader = new THREE.ObjectLoader();
      loader.load(fileName, (obj: THREE.Object3D) => {
        // Collect materials from all meshes in the loaded object
        var materials: THREE.Material[] = [];
        obj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            var mat = (child as THREE.Mesh).material;
            if (Array.isArray(mat)) {
              mat.forEach(m => materials.push(m));
            } else {
              materials.push(mat);
            }
          }
        });

        // Use first mesh geometry if available, otherwise empty BufferGeometry
        var geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
        obj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh && geometry.attributes.position === undefined) {
            geometry = (child as THREE.Mesh).geometry as THREE.BufferGeometry;
          }
        });

        var material: THREE.Material | THREE.Material[] = materials.length > 0 ? materials : new THREE.MeshStandardMaterial();

        var item = new (Factory.getClass(itemType))(
          scope.model,
          metadata,
          geometry,
          material,
          position, rotation, scale
        );
        item.fixed = fixed || false;
        scope.items.push(item);
        scope.add(item);
        item.initObject();
        scope.itemLoadedCallbacks.fire(item);
      });
    });

    this.itemLoadingCallbacks.fire();
  }
}
