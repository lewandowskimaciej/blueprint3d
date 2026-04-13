import { Model } from './model/model';
import { Main as ThreeMain } from './three/main';
import { Floorplanner } from './floorplanner/floorplanner';
import { Version } from './core/version';

/** Startup options. */
export interface Options {
  /** */
  widget?: boolean;

  /** */
  threeElement?: string;

  /** */
  threeCanvasElement?: string;

  /** */
  floorplannerElement?: string;

  /** The texture directory. */
  textureDir?: string;

  /** Render scene on the main thread using WebGLRenderer. */
  useMainRenderer?: boolean;

  /** Prefer WebGPU renderer with automatic fallback to WebGL. */
  preferWebGPU?: boolean;
}

/** Blueprint3D core application. */
export class Blueprint3d {

  public model: Model;

  public three: any;

  public floorplanner: Floorplanner;

  /**
   * Creates an instance.
   * @param options The initialization options.
   */
  constructor(options: Options) {
    this.model = new Model(options.textureDir || '');
    this.three = new (ThreeMain as any)(
      this.model,
      options.threeElement,
      options.threeCanvasElement,
      {
        renderEnabled: options.useMainRenderer !== false,
        preferWebGPU: options.preferWebGPU !== false
      }
    );

    if (!options.widget) {
      this.floorplanner = new Floorplanner(options.floorplannerElement, this.model.floorplan);
    } else {
      this.three.getController().enabled = false;
    }
  }
}

if (typeof window !== "undefined") {
  (window as any).BP3D = { Blueprint3d };
}

console.log('BP3D loaded, version:', Version.getInformalVersion());
