import * as THREE from 'three';
import { Callbacks } from '../core/callbacks';
import { Utils } from '../core/utils';
import { Corner } from './corner';
import { HalfEdge } from './half_edge';

const defaultRoomTexture = {
  url: "rooms/textures/hardwood.png",
  scale: 400
};

export class Room {
  public interiorCorners: any[] = [];
  private edgePointer: any = null;
  public floorPlane: THREE.Mesh = null;
  private floorChangeCallbacks = new Callbacks();

  constructor(private floorplan: any, public corners: Corner[]) {
    this.updateWalls();
    this.updateInteriorCorners();
    this.generatePlane();
  }

  public getUuid(): string {
    var cornerUuids = Utils.map(this.corners, (c) => c.id);
    cornerUuids.sort();
    return cornerUuids.join();
  }

  public fireOnFloorChange(callback) { this.floorChangeCallbacks.add(callback); }

  public getTexture() {
    var uuid = this.getUuid();
    var tex = this.floorplan.getFloorTexture(uuid);
    return tex || defaultRoomTexture;
  }

  public setTexture(textureUrl: string, _textureStretch: boolean, textureScale: number) {
    this.floorplan.setFloorTexture(this.getUuid(), textureUrl, textureScale);
    this.floorChangeCallbacks.fire();
  }

  private generatePlane() {
    var points: THREE.Vector2[] = [];
    this.interiorCorners.forEach((corner) => {
      points.push(new THREE.Vector2(corner.x, corner.y));
    });
    var shape = new THREE.Shape(points);
    var geometry = new THREE.ShapeGeometry(shape);
    this.floorPlane = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.floorPlane.visible = false;
    this.floorPlane.rotation.set(Math.PI / 2, 0, 0);
    (this.floorPlane as any).room = this;
  }

  private updateInteriorCorners() {
    var edge = this.edgePointer;
    while (true) {
      this.interiorCorners.push(edge.interiorStart());
      edge.generatePlane();
      if (edge.next === this.edgePointer) break;
      else edge = edge.next;
    }
  }

  private updateWalls() {
    var prevEdge: HalfEdge = null;
    var firstEdge: HalfEdge = null;

    for (var i = 0; i < this.corners.length; i++) {
      var firstCorner = this.corners[i];
      var secondCorner = this.corners[(i + 1) % this.corners.length];
      var wallTo = firstCorner.wallTo(secondCorner);
      var wallFrom = firstCorner.wallFrom(secondCorner);

      var edge: HalfEdge;
      if (wallTo) {
        edge = new HalfEdge(this, wallTo, true);
      } else if (wallFrom) {
        edge = new HalfEdge(this, wallFrom, false);
      } else {
        console.log("corners arent connected by a wall, uh oh");
        continue;
      }

      if (i == 0) {
        firstEdge = edge;
      } else {
        edge.prev = prevEdge;
        prevEdge.next = edge;
        if (i + 1 == this.corners.length) {
          firstEdge.prev = edge;
          edge.next = firstEdge;
        }
      }
      prevEdge = edge;
    }
    this.edgePointer = firstEdge;
  }
}
