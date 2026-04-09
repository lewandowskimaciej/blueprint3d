import * as THREE from 'three';
import { Utils } from '../core/utils';
import { HalfEdge } from '../model/half_edge';
import { Item } from './item';
import { Metadata } from './metadata';

/**
 * A Wall Item is an entity to be placed related to a wall.
 */
export abstract class WallItem extends Item {
  /** The currently applied wall edge. */
  protected currentWallEdge: HalfEdge = null;

  /** used for finding rotations */
  private refVec = new THREE.Vector2(0, 1.0);

  /** */
  private wallOffsetScalar = 0;

  /** */
  private sizeX = 0;

  /** */
  private sizeY = 0;

  /** */
  protected addToWall = false;

  /** */
  protected boundToFloor = false;

  /** */
  protected frontVisible = false;

  /** */
  protected backVisible = false;

  constructor(model: any, metadata: Metadata, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], position: THREE.Vector3, rotation: number, scale: THREE.Vector3) {
    super(model, metadata, geometry, material, position, rotation, scale);
    this.allowRotate = false;
  }

  /** Get the closest wall edge. */
  public closestWallEdge(): HalfEdge {
    var wallEdges = this.model.floorplan.wallEdges();

    var wallEdge = null;
    var minDistance = null;

    var itemX = this.position.x;
    var itemZ = this.position.z;

    wallEdges.forEach((edge: HalfEdge) => {
      var distance = edge.distanceTo(itemX, itemZ);
      if (minDistance === null || distance < minDistance) {
        minDistance = distance;
        wallEdge = edge;
      }
    });

    return wallEdge;
  }

  /** */
  public removed() {
    if (this.currentWallEdge != null && this.addToWall) {
      Utils.removeValue(this.currentWallEdge.wall.items, this);
      this.redrawWall();
    }
  }

  /** */
  private redrawWall() {
    if (this.addToWall) {
      this.currentWallEdge.wall.fireRedraw();
    }
  }

  /** */
  private updateEdgeVisibility(visible: boolean, front: boolean) {
    if (front) {
      this.frontVisible = visible;
    } else {
      this.backVisible = visible;
    }
    this.visible = (this.frontVisible || this.backVisible);
  }

  /** */
  private updateSize() {
    var bb = this.geometry.boundingBox;
    if (bb) {
      this.wallOffsetScalar = (bb.max.z - bb.min.z) * this.scale.z / 2.0;
      this.sizeX = (bb.max.x - bb.min.x) * this.scale.x;
      this.sizeY = (bb.max.y - bb.min.y) * this.scale.y;
    }
  }

  /** */
  public resized() {
    var bb = this.geometry.boundingBox;
    if (this.boundToFloor && bb) {
      this.position.y = 0.5 * (bb.max.y - bb.min.y) * this.scale.y + 0.01;
    }
    this.updateSize();
    this.redrawWall();
  }

  /** */
  public placeInRoom() {
    var closestWallEdge = this.closestWallEdge();
    this.changeWallEdge(closestWallEdge);
    this.updateSize();

    if (!this.position_set) {
      var center = closestWallEdge.interiorCenter();
      var newPos = new THREE.Vector3(
        center.x,
        closestWallEdge.wall.height / 2.0,
        center.y);
      this.boundMove(newPos);
      this.position.copy(newPos);
      this.redrawWall();
    }
  }

  /** */
  public moveToPosition(vec3, intersection) {
    this.changeWallEdge(intersection.object.edge);
    this.boundMove(vec3);
    this.position.copy(vec3);
    this.redrawWall();
  }

  /** */
  protected getWallOffset() {
    return this.wallOffsetScalar;
  }

  /** */
  private changeWallEdge(wallEdge) {
    if (this.currentWallEdge != null) {
      if (this.addToWall) {
        Utils.removeValue(this.currentWallEdge.wall.items, this);
        this.redrawWall();
      } else {
        Utils.removeValue(this.currentWallEdge.wall.onItems, this);
      }
    }

    if (this.currentWallEdge != null) {
      this.currentWallEdge.wall.dontFireOnDelete(this.remove.bind(this));
    }
    wallEdge.wall.fireOnDelete(this.remove.bind(this));

    // find angle between wall normals using plane's quaternion
    // (geometry.faces[0].normal was removed in r125)
    var normal2 = new THREE.Vector2();
    var planeQuaternion = wallEdge.plane.quaternion;
    var defaultNormal = new THREE.Vector3(0, 0, 1);
    var worldNormal = defaultNormal.clone().applyQuaternion(planeQuaternion);
    normal2.x = worldNormal.x;
    normal2.y = worldNormal.z;

    var angle = Utils.angle(
      this.refVec.x, this.refVec.y,
      normal2.x, normal2.y);
    this.rotation.y = angle;

    this.currentWallEdge = wallEdge;
    if (this.addToWall) {
      wallEdge.wall.items.push(this);
      this.redrawWall();
    } else {
      wallEdge.wall.onItems.push(this);
    }
  }

  /** Returns an array of planes to use other than the ground plane */
  public customIntersectionPlanes() {
    return this.model.floorplan.wallEdgePlanes();
  }

  /** takes the move vec3, and makes sure object stays bounded on plane */
  private boundMove(vec3) {
    var tolerance = 1;
    var edge = this.currentWallEdge;
    vec3.applyMatrix4(edge.interiorTransform);

    if (vec3.x < this.sizeX / 2.0 + tolerance) {
      vec3.x = this.sizeX / 2.0 + tolerance;
    } else if (vec3.x > (edge.interiorDistance() - this.sizeX / 2.0 - tolerance)) {
      vec3.x = edge.interiorDistance() - this.sizeX / 2.0 - tolerance;
    }

    var bb = this.geometry.boundingBox;
    if (this.boundToFloor && bb) {
      vec3.y = 0.5 * (bb.max.y - bb.min.y) * this.scale.y + 0.01;
    } else {
      if (vec3.y < this.sizeY / 2.0 + tolerance) {
        vec3.y = this.sizeY / 2.0 + tolerance;
      } else if (vec3.y > edge.height - this.sizeY / 2.0 - tolerance) {
        vec3.y = edge.height - this.sizeY / 2.0 - tolerance;
      }
    }

    vec3.z = this.getWallOffset();

    vec3.applyMatrix4(edge.invInteriorTransform);
  }
}
