import * as THREE from 'three';
import { Utils } from '../core/utils';
import { Item } from './item';
import { Metadata } from './metadata';

/**
 * A Floor Item is an entity to be placed related to a floor.
 */
export abstract class FloorItem extends Item {
  constructor(model: any, metadata: Metadata, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], position: THREE.Vector3, rotation: number, scale: THREE.Vector3) {
    super(model, metadata, geometry, material, position, rotation, scale);
  }

  /** */
  public placeInRoom() {
    if (!this.position_set) {
      var center = this.model.floorplan.getCenter();
      this.position.x = center.x;
      this.position.z = center.z;
      var bb = this.geometry.boundingBox;
      if (bb) {
        this.position.y = 0.5 * (bb.max.y - bb.min.y);
      }
    }
  }

  /** Take action after a resize */
  public resized() {
    this.position.y = this.halfSize.y;
  }

  /** */
  public moveToPosition(vec3, intersection) {
    if (!this.isValidPosition(vec3)) {
      this.showError(vec3);
      return;
    } else {
      this.hideError();
      vec3.y = this.position.y;
      this.position.copy(vec3);
    }
  }

  /** */
  public isValidPosition(vec3): boolean {
    var corners = this.getCorners('x', 'z', vec3);

    var rooms = this.model.floorplan.getRooms();
    var isInARoom = false;
    for (var i = 0; i < rooms.length; i++) {
      if (Utils.pointInPolygon(vec3.x, vec3.z, rooms[i].interiorCorners) &&
        !Utils.polygonPolygonIntersect(corners, rooms[i].interiorCorners)) {
        isInARoom = true;
      }
    }
    if (!isInARoom) {
      return false;
    }

    return true;
  }
}
