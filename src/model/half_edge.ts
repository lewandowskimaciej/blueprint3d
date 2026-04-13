import * as THREE from 'three';
import { Callbacks } from '../core/callbacks';
import { Utils } from '../core/utils';
import { Wall } from './wall';
import { Corner } from './corner';

export class HalfEdge {
  public next: HalfEdge;
  public prev: HalfEdge;
  public offset: number;
  public height: number;
  public plane: THREE.Mesh = null;
  public interiorTransform = new THREE.Matrix4();
  public invInteriorTransform = new THREE.Matrix4();
  public exteriorTransform = new THREE.Matrix4();
  public invExteriorTransform = new THREE.Matrix4();
  public redrawCallbacks = new Callbacks();

  constructor(private room: any, public wall: Wall, private front: boolean) {
    this.front = front || false;
    this.offset = wall.thickness / 2.0;
    this.height = wall.height;
    if (this.front) {
      this.wall.frontEdge = this;
    } else {
      this.wall.backEdge = this;
    }
  }

  public getTexture() {
    if (this.front) return this.wall.frontTexture;
    else return this.wall.backTexture;
  }

  public setTexture(textureUrl: string, textureStretch: boolean, textureScale: number) {
    var texture = { url: textureUrl, stretch: textureStretch, scale: textureScale };
    if (this.front) this.wall.frontTexture = texture;
    else this.wall.backTexture = texture;
    this.redrawCallbacks.fire();
  }

  public generatePlane() {
    function transformCorner(corner) {
      return new THREE.Vector3(corner.x, 0, corner.y);
    }

    var v1 = transformCorner(this.interiorStart());
    var v2 = transformCorner(this.interiorEnd());
    var v3 = v2.clone(); v3.y = this.wall.height;
    var v4 = v1.clone(); v4.y = this.wall.height;

    // Use BufferGeometry instead of the removed Geometry
    const points: THREE.Vector3[] = [v1, v2, v3, v1, v3, v4];
    const geometry = new THREE.BufferGeometry();
    (geometry as any).setFromPoints(points);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    this.plane = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    this.plane.visible = false;
    (this.plane as any).edge = this;

    this.computeTransforms(
      this.interiorTransform, this.invInteriorTransform,
      this.interiorStart(), this.interiorEnd());
    this.computeTransforms(
      this.exteriorTransform, this.invExteriorTransform,
      this.exteriorStart(), this.exteriorEnd());
  }

  public interiorDistance(): number {
    var start = this.interiorStart();
    var end = this.interiorEnd();
    return Utils.distance(start.x, start.y, end.x, end.y);
  }

  private computeTransforms(transform: THREE.Matrix4, invTransform: THREE.Matrix4, start, end) {
    var v1 = start;
    var v2 = end;
    var angle = Utils.angle(1, 0, v2.x - v1.x, v2.y - v1.y);
    var tt = new THREE.Matrix4();
    tt.makeTranslation(-v1.x, 0, -v1.y);
    var tr = new THREE.Matrix4();
    tr.makeRotationY(-angle);
    transform.multiplyMatrices(tr, tt);
    (invTransform as any).copy(transform).invert();
  }

  public distanceTo(x: number, y: number): number {
    return Utils.pointDistanceFromLine(x, y,
      this.interiorStart().x, this.interiorStart().y,
      this.interiorEnd().x, this.interiorEnd().y);
  }

  private getStart(): Corner {
    if (this.front) return this.wall.getStart();
    else return this.wall.getEnd();
  }

  private getEnd(): Corner {
    if (this.front) return this.wall.getEnd();
    else return this.wall.getStart();
  }

  private getOppositeEdge(): HalfEdge {
    if (this.front) return this.wall.backEdge;
    else return this.wall.frontEdge;
  }

  public interiorEnd(): { x: number, y: number } {
    var vec = this.halfAngleVector(this, this.next);
    return { x: this.getEnd().x + vec.x, y: this.getEnd().y + vec.y };
  }

  public interiorStart(): { x: number, y: number } {
    var vec = this.halfAngleVector(this.prev, this);
    return { x: this.getStart().x + vec.x, y: this.getStart().y + vec.y };
  }

  public interiorCenter(): { x: number, y: number } {
    return {
      x: (this.interiorStart().x + this.interiorEnd().x) / 2.0,
      y: (this.interiorStart().y + this.interiorEnd().y) / 2.0,
    };
  }

  public exteriorEnd(): { x: number, y: number } {
    var vec = this.halfAngleVector(this, this.next);
    return { x: this.getEnd().x - vec.x, y: this.getEnd().y - vec.y };
  }

  public exteriorStart(): { x: number, y: number } {
    var vec = this.halfAngleVector(this.prev, this);
    return { x: this.getStart().x - vec.x, y: this.getStart().y - vec.y };
  }

  public corners(): { x: number, y: number }[] {
    return [this.interiorStart(), this.interiorEnd(), this.exteriorEnd(), this.exteriorStart()];
  }

  private halfAngleVector(v1: HalfEdge, v2: HalfEdge): { x: number, y: number } {
    var v1startX, v1startY, v1endX, v1endY;
    var v2startX, v2startY, v2endX, v2endY;

    if (!v1) {
      v1startX = v2.getStart().x - (v2.getEnd().x - v2.getStart().x);
      v1startY = v2.getStart().y - (v2.getEnd().y - v2.getStart().y);
      v1endX = v2.getStart().x;
      v1endY = v2.getStart().y;
    } else {
      v1startX = v1.getStart().x;
      v1startY = v1.getStart().y;
      v1endX = v1.getEnd().x;
      v1endY = v1.getEnd().y;
    }

    if (!v2) {
      v2startX = v1.getEnd().x;
      v2startY = v1.getEnd().y;
      v2endX = v1.getEnd().x + (v1.getEnd().x - v1.getStart().x);
      v2endY = v1.getEnd().y + (v1.getEnd().y - v1.getStart().y);
    } else {
      v2startX = v2.getStart().x;
      v2startY = v2.getStart().y;
      v2endX = v2.getEnd().x;
      v2endY = v2.getEnd().y;
    }

    var theta = Utils.angle2pi(
      v1startX - v1endX, v1startY - v1endY,
      v2endX - v1endX, v2endY - v1endY);

    var cs = Math.cos(theta / 2.0);
    var sn = Math.sin(theta / 2.0);

    var v2dx = v2endX - v2startX;
    var v2dy = v2endY - v2startY;

    var vx = v2dx * cs - v2dy * sn;
    var vy = v2dx * sn + v2dy * cs;

    var mag = Utils.distance(0, 0, vx, vy);
    var desiredMag = (this.offset) / sn;
    var scalar = desiredMag / mag;

    return { x: vx * scalar, y: vy * scalar };
  }
}
