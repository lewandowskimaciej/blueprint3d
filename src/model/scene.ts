import * as THREE from 'three';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { Callbacks } from '../core/callbacks';
import { Utils } from '../core/utils';
import { loadTextureCompat } from '../core/texture_loader';
import { Factory } from '../items/factory';

type MaterialMode = 'classic' | 'node';

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
  private materialMode: MaterialMode = 'classic';

  /** */
  private itemLoadingCallbacks = new Callbacks();

  /** Item */
  public itemLoadedCallbacks = new Callbacks();

  /** Item */
  public itemRemovedCallbacks = new Callbacks();

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

  /** Sets preferred material system for newly created objects. */
  public setMaterialMode(mode: MaterialMode) {
    this.materialMode = mode === 'node' ? 'node' : 'classic';
  }

  /** Gets preferred material system. */
  public getMaterialMode(): MaterialMode {
    return this.materialMode;
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

    this.itemLoadingCallbacks.fire();

    var fileLoader = new THREE.FileLoader();
    fileLoader.load(fileName, (fileData: string) => {
      try {
        var json = scope.parseModelJson(fileData, fileName);
        var parsed: { geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[] };

        if (scope.isLegacyGeometryFormat(json)) {
          parsed = {
            geometry: scope.parseLegacyGeometry(json),
            material: scope.createLegacyMaterials(json.materials || [], fileName)
          };
        } else {
          parsed = scope.parseObjectFormat(json);
        }

        var item = new (Factory.getClass(itemType))(
          scope.model,
          metadata,
          parsed.geometry,
          parsed.material,
          position,
          rotation,
          scale
        );
        item.fixed = fixed || false;
        scope.items.push(item);
        scope.add(item);
        item.initObject();
        scope.itemLoadedCallbacks.fire(item);
      } catch (error) {
        console.error(`Failed to parse model "${fileName}"`, error);
        scope.itemLoadedCallbacks.fire(null);
      }
    }, undefined, (error) => {
      console.error(`Failed to load model "${fileName}"`, error);
      scope.itemLoadedCallbacks.fire(null);
    });
  }

  private parseModelJson(fileData: string, fileName: string): any {
    if (typeof fileData !== 'string') {
      throw new Error(`Model "${fileName}" returned non-text payload`);
    }

    var directCandidate = fileData.replace(/^\uFEFF/, '').trim();
    try {
      return JSON.parse(directCandidate);
    } catch (directError) {
      var firstBrace = directCandidate.indexOf('{');
      var lastBrace = directCandidate.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        throw directError;
      }

      var extractedJson = directCandidate.slice(firstBrace, lastBrace + 1);
      return JSON.parse(extractedJson);
    }
  }

  private isLegacyGeometryFormat(json: any): boolean {
    return (
      !!json &&
      Array.isArray(json.vertices) &&
      Array.isArray(json.faces) &&
      !!json.metadata &&
      typeof json.metadata.formatVersion === 'number' &&
      json.metadata.formatVersion <= 3.1
    );
  }

  private parseObjectFormat(json: any): { geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[] } {
    var object = new THREE.ObjectLoader().parse(json);

    var geometry: THREE.BufferGeometry = null;
    var materials: THREE.Material[] = [];
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        var mesh = child as THREE.Mesh;
        if (!geometry) {
          geometry = mesh.geometry as THREE.BufferGeometry;
        }
        var meshMaterial = mesh.material;
        if (Array.isArray(meshMaterial)) {
          meshMaterial.forEach((material) => {
            if (material) {
              materials.push(material);
            }
          });
        } else if (meshMaterial) {
          materials.push(meshMaterial);
        }
      }
    });

    if (!geometry) {
      geometry = new THREE.BufferGeometry();
    }

    var material: THREE.Material | THREE.Material[] =
      materials.length === 0
        ? this.createPBRMaterial({})
        : (materials.length === 1 ? materials[0] : materials);

    if (Array.isArray(material)) {
      material = material.map((entry) => this.enhanceImportedMaterial(entry));
    } else {
      material = this.enhanceImportedMaterial(material);
    }

    return { geometry, material };
  }

  private parseLegacyGeometry(json: any): THREE.BufferGeometry {
    var faces: number[] = json.faces || [];
    var vertices: number[] = json.vertices || [];
    var normals: number[] = json.normals || [];
    var uvLayers: number[][] = Array.isArray(json.uvs) ? json.uvs : [];
    var uvLayer: number[] = Array.isArray(uvLayers[0]) ? uvLayers[0] : [];
    var uvLayersCount = uvLayers.length;
    var verticesScale = (typeof json.scale === 'number' && json.scale !== 0) ? (1 / json.scale) : 1;

    var positionsOut: number[] = [];
    var normalsOut: number[] = [];
    var uvsOut: number[] = [];
    var geometry = new THREE.BufferGeometry();

    var groups: { start: number, count: number, materialIndex: number }[] = [];
    var currentGroup: { start: number, count: number, materialIndex: number } = null;
    var verticesCount = 0;
    var supportsUvs = uvLayer.length > 0;

    var startGroup = (materialIndex: number) => {
      if (!currentGroup || currentGroup.materialIndex !== materialIndex) {
        currentGroup = { start: verticesCount, count: 0, materialIndex };
        groups.push(currentGroup);
      }
    };

    var pushVertex = (vertexIndex: number, vertexNormalIndex: number, faceNormalIndex: number, vertexUvIndex: number) => {
      var vertexOffset = vertexIndex * 3;
      positionsOut.push(
        vertices[vertexOffset] * verticesScale,
        vertices[vertexOffset + 1] * verticesScale,
        vertices[vertexOffset + 2] * verticesScale
      );

      if (vertexNormalIndex >= 0) {
        var normalOffset = vertexNormalIndex * 3;
        normalsOut.push(normals[normalOffset], normals[normalOffset + 1], normals[normalOffset + 2]);
      } else if (faceNormalIndex >= 0) {
        var faceNormalOffset = faceNormalIndex * 3;
        normalsOut.push(normals[faceNormalOffset], normals[faceNormalOffset + 1], normals[faceNormalOffset + 2]);
      }

      if (supportsUvs) {
        if (vertexUvIndex >= 0) {
          var uvOffset = vertexUvIndex * 2;
          uvsOut.push(uvLayer[uvOffset], uvLayer[uvOffset + 1]);
        } else {
          uvsOut.push(0, 0);
        }
      }
    };

    var pushTriangle = (
      a: number,
      b: number,
      c: number,
      materialIndex: number,
      uvIndices: number[],
      normalIndices: number[],
      faceNormalIndex: number
    ) => {
      startGroup(materialIndex);

      pushVertex(a, normalIndices[0], faceNormalIndex, uvIndices[0]);
      pushVertex(b, normalIndices[1], faceNormalIndex, uvIndices[1]);
      pushVertex(c, normalIndices[2], faceNormalIndex, uvIndices[2]);

      verticesCount += 3;
      currentGroup.count += 3;
    };

    var offset = 0;
    while (offset < faces.length) {
      var type = faces[offset++];
      var isQuad = (type & 1) === 1;
      var hasMaterial = (type & 2) === 2;
      var hasFaceUv = (type & 4) === 4;
      var hasFaceVertexUv = (type & 8) === 8;
      var hasFaceNormal = (type & 16) === 16;
      var hasFaceVertexNormal = (type & 32) === 32;
      var hasFaceColor = (type & 64) === 64;
      var hasFaceVertexColor = (type & 128) === 128;

      if (isQuad) {
        var a = faces[offset++];
        var b = faces[offset++];
        var c = faces[offset++];
        var d = faces[offset++];

        var materialIndex = hasMaterial ? faces[offset++] : 0;

        if (hasFaceUv) {
          for (var layer = 0; layer < uvLayersCount; layer++) {
            offset++;
          }
        }

        var faceUvIndices: number[] = [-1, -1, -1, -1];
        if (hasFaceVertexUv) {
          for (var layer = 0; layer < uvLayersCount; layer++) {
            var ua = faces[offset++];
            var ub = faces[offset++];
            var uc = faces[offset++];
            var ud = faces[offset++];
            if (layer === 0) {
              faceUvIndices = [ua, ub, uc, ud];
            }
          }
        }

        var faceNormalIndex = -1;
        if (hasFaceNormal) {
          faceNormalIndex = faces[offset++];
        }

        var faceNormalIndices: number[] = [-1, -1, -1, -1];
        if (hasFaceVertexNormal) {
          var na = faces[offset++];
          var nb = faces[offset++];
          var nc = faces[offset++];
          var nd = faces[offset++];
          faceNormalIndices = [na, nb, nc, nd];
        }

        if (hasFaceColor) {
          offset++;
        }
        if (hasFaceVertexColor) {
          offset += 4;
        }

        // Legacy quad triangulation follows old THREE.JSONLoader behavior.
        pushTriangle(
          a, b, d, materialIndex,
          [faceUvIndices[0], faceUvIndices[1], faceUvIndices[3]],
          [faceNormalIndices[0], faceNormalIndices[1], faceNormalIndices[3]],
          faceNormalIndex
        );
        pushTriangle(
          b, c, d, materialIndex,
          [faceUvIndices[1], faceUvIndices[2], faceUvIndices[3]],
          [faceNormalIndices[1], faceNormalIndices[2], faceNormalIndices[3]],
          faceNormalIndex
        );
      } else {
        var ta = faces[offset++];
        var tb = faces[offset++];
        var tc = faces[offset++];

        var triangleMaterialIndex = hasMaterial ? faces[offset++] : 0;

        if (hasFaceUv) {
          for (var uvLayerIndex = 0; uvLayerIndex < uvLayersCount; uvLayerIndex++) {
            offset++;
          }
        }

        var triangleUvIndices: number[] = [-1, -1, -1];
        if (hasFaceVertexUv) {
          for (var layerIndex = 0; layerIndex < uvLayersCount; layerIndex++) {
            var tua = faces[offset++];
            var tub = faces[offset++];
            var tuc = faces[offset++];
            if (layerIndex === 0) {
              triangleUvIndices = [tua, tub, tuc];
            }
          }
        }

        var triangleFaceNormalIndex = -1;
        if (hasFaceNormal) {
          triangleFaceNormalIndex = faces[offset++];
        }

        var triangleFaceNormalIndices: number[] = [-1, -1, -1];
        if (hasFaceVertexNormal) {
          triangleFaceNormalIndices = [faces[offset++], faces[offset++], faces[offset++]];
        }

        if (hasFaceColor) {
          offset++;
        }
        if (hasFaceVertexColor) {
          offset += 3;
        }

        pushTriangle(
          ta,
          tb,
          tc,
          triangleMaterialIndex,
          triangleUvIndices,
          triangleFaceNormalIndices,
          triangleFaceNormalIndex
        );
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionsOut, 3));

    if (normalsOut.length === positionsOut.length) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalsOut, 3));
    } else {
      geometry.computeVertexNormals();
    }

    if (supportsUvs && uvsOut.length / 2 === positionsOut.length / 3) {
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvsOut, 2));
    }

    groups.forEach((group) => {
      geometry.addGroup(group.start, group.count, group.materialIndex);
    });

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }

  private createLegacyMaterials(materialsData: any[], fileName: string): THREE.Material | THREE.Material[] {
    if (!Array.isArray(materialsData) || materialsData.length === 0) {
      return this.createPBRMaterial({});
    }

    var materials = materialsData.map((sourceMaterial) => {
      var opacity = typeof sourceMaterial.transparency === 'number' ? sourceMaterial.transparency : 1;
      var baseParams: any = {
        transparent: !!sourceMaterial.transparent || opacity < 1,
        opacity
      };

      if (Array.isArray(sourceMaterial.colorDiffuse) && sourceMaterial.colorDiffuse.length >= 3) {
        baseParams.color = new THREE.Color(
          sourceMaterial.colorDiffuse[0],
          sourceMaterial.colorDiffuse[1],
          sourceMaterial.colorDiffuse[2]
        );
      }
      if (Array.isArray(sourceMaterial.colorEmissive) && sourceMaterial.colorEmissive.length >= 3) {
        baseParams.emissive = new THREE.Color(
          sourceMaterial.colorEmissive[0],
          sourceMaterial.colorEmissive[1],
          sourceMaterial.colorEmissive[2]
        );
      }

      var material = this.createPBRMaterial({
        ...baseParams,
        roughness: this.estimateLegacyRoughness(sourceMaterial),
        metalness: this.estimateLegacyMetalness(sourceMaterial),
        clearcoat: this.estimateLegacyClearcoat(sourceMaterial),
        clearcoatRoughness: 0.25,
        envMapIntensity: 1.2
      });

      if (typeof sourceMaterial.mapDiffuse === 'string' && sourceMaterial.mapDiffuse.length > 0) {
        var texturePath = this.resolveRelativePath(fileName, sourceMaterial.mapDiffuse);
        var texture = loadTextureCompat(texturePath, () => {
          this.needsUpdate = true;
        });
        texture.colorSpace = THREE.SRGBColorSpace;
        if (Array.isArray(sourceMaterial.mapDiffuseWrap) && sourceMaterial.mapDiffuseWrap.length >= 2) {
          texture.wrapS = this.parseLegacyWrapMode(sourceMaterial.mapDiffuseWrap[0]);
          texture.wrapT = this.parseLegacyWrapMode(sourceMaterial.mapDiffuseWrap[1]);
        }

        var meshMaterial = material as any;
        meshMaterial.map = texture;
        meshMaterial.needsUpdate = true;
      }

      return this.enhanceImportedMaterial(material);
    });

    return materials.length === 1 ? materials[0] : materials;
  }

  private createPBRMaterial(params: any): THREE.Material {
    var baseParams: any = {
      roughness: 0.75,
      metalness: 0.05,
      envMapIntensity: 1.0,
      ...params
    };
    if (this.materialMode === 'node') {
      return new (MeshPhysicalNodeMaterial as any)(baseParams);
    }
    return new THREE.MeshPhysicalMaterial(baseParams);
  }

  private enhanceImportedMaterial(material: THREE.Material): THREE.Material {
    var asAny = material as any;
    var side = typeof asAny.side === 'number' ? asAny.side : THREE.FrontSide;
    var opacity = typeof asAny.opacity === 'number' ? asAny.opacity : 1;
    var transparent = !!asAny.transparent || opacity < 1;
    var emissive = asAny.emissive ? asAny.emissive.clone() : new THREE.Color(0x000000);

    var pbrParams: any = {
      color: asAny.color ? asAny.color.clone() : new THREE.Color(0xffffff),
      map: asAny.map || null,
      normalMap: asAny.normalMap || null,
      aoMap: asAny.aoMap || null,
      emissive,
      emissiveMap: asAny.emissiveMap || null,
      transparent,
      opacity,
      side,
      roughness: 0.72,
      metalness: 0.08,
      clearcoat: 0.06,
      clearcoatRoughness: 0.32,
      envMapIntensity: 1.25
    };

    if ('roughness' in asAny && typeof asAny.roughness === 'number') {
      pbrParams.roughness = THREE.MathUtils.clamp(asAny.roughness, 0, 1);
    }
    if ('metalness' in asAny && typeof asAny.metalness === 'number') {
      pbrParams.metalness = THREE.MathUtils.clamp(asAny.metalness, 0, 1);
    }
    if (asAny.shininess && typeof asAny.shininess === 'number') {
      pbrParams.roughness = THREE.MathUtils.clamp(1 - Math.min(1, asAny.shininess / 128), 0.08, 0.95);
    }

    var upgraded = this.createPBRMaterial(pbrParams) as any;
    if (upgraded.map && upgraded.map.colorSpace == null) {
      upgraded.map.colorSpace = THREE.SRGBColorSpace;
    }
    upgraded.needsUpdate = true;
    return upgraded as THREE.Material;
  }

  private estimateLegacyRoughness(sourceMaterial: any): number {
    if (typeof sourceMaterial.specularCoef === 'number') {
      return THREE.MathUtils.clamp(1 - Math.min(1, sourceMaterial.specularCoef / 128), 0.08, 0.95);
    }
    return 0.75;
  }

  private estimateLegacyMetalness(sourceMaterial: any): number {
    if (Array.isArray(sourceMaterial.colorSpecular) && sourceMaterial.colorSpecular.length >= 3) {
      var avgSpec = (sourceMaterial.colorSpecular[0] + sourceMaterial.colorSpecular[1] + sourceMaterial.colorSpecular[2]) / 3;
      return THREE.MathUtils.clamp(avgSpec * 0.35, 0, 0.45);
    }
    return 0.04;
  }

  private estimateLegacyClearcoat(sourceMaterial: any): number {
    var shading = typeof sourceMaterial.shading === 'string' ? sourceMaterial.shading.toLowerCase() : '';
    if (shading === 'phong') {
      return 0.12;
    }
    return 0.03;
  }

  private parseLegacyWrapMode(mode: string): THREE.Wrapping {
    if (mode === 'repeat') {
      return THREE.RepeatWrapping;
    }
    if (mode === 'mirror') {
      return THREE.MirroredRepeatWrapping;
    }
    return THREE.ClampToEdgeWrapping;
  }

  private resolveRelativePath(basePath: string, relativePath: string): string {
    if (/^(https?:)?\/\//.test(relativePath) || relativePath.startsWith('/')) {
      return relativePath;
    }
    var normalizedBase = basePath.replace(/\\/g, '/');
    var slashIndex = normalizedBase.lastIndexOf('/');
    if (slashIndex === -1) {
      return relativePath;
    }
    return `${normalizedBase.slice(0, slashIndex + 1)}${relativePath}`;
  }
}
