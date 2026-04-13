export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface CameraState {
  position: Vector3Like;
  target: Vector3Like;
}

export type SceneCommand =
  | {
      type: 'add_item';
      itemType: number;
      fileName: string;
      metadata: any;
      position?: Vector3Like | null;
      rotation?: number;
      scale?: Vector3Like | null;
      fixed?: boolean;
    }
  | {
      type: 'remove_item';
      itemIndex: number;
    }
  | {
      type: 'update_item_transform';
      itemIndex: number;
      position?: Vector3Like;
      rotationY?: number;
      scale?: Vector3Like;
      matrix?: number[];
    }
  | {
      type: 'update_item_material';
      itemIndex: number;
      color?: number;
      emissive?: number;
      opacity?: number;
      transparent?: boolean;
      metalness?: number;
      roughness?: number;
    }
  | {
      type: 'set_item_fixed';
      itemIndex: number;
      fixed: boolean;
    }
  | {
      type: 'set_wall_texture';
      wallIndex: number;
      side: 'front' | 'back';
      textureUrl: string;
      stretch: boolean;
      scale: number;
    }
  | {
      type: 'set_floor_texture';
      roomUuid: string;
      textureUrl: string;
      scale: number;
    }
  | {
      type: 'replace_serialized_state';
      serialized: string;
    };

export interface WorkerInitPayload {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  devicePixelRatio: number;
  textureDir: string;
  serialized?: string;
}

export type WorkerRequestPayloadMap = {
  init: WorkerInitPayload;
  resize: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  load_serialized: {
    serialized: string;
    recordHistory?: boolean;
    centerCamera?: boolean;
  };
  set_camera: {
    camera: CameraState;
  };
  center_camera: {};
  apply_scene_command: {
    command: SceneCommand;
    recordHistory?: boolean;
  };
  apply_scene_commands: {
    commands: SceneCommand[];
    recordHistory?: boolean;
  };
  export_serialized: {};
  get_history_state: {};
  undo: {};
  redo: {};
  dispose: {};
};

export type WorkerResponsePayloadMap = {
  init: { ok: true };
  resize: { ok: true };
  load_serialized: { ok: true };
  set_camera: { ok: true };
  center_camera: { ok: true };
  apply_scene_command: { ok: true };
  apply_scene_commands: { ok: true };
  export_serialized: { serialized: string };
  get_history_state: { canUndo: boolean; canRedo: boolean };
  undo: { ok: boolean; serialized?: string; canUndo: boolean; canRedo: boolean };
  redo: { ok: boolean; serialized?: string; canUndo: boolean; canRedo: boolean };
  dispose: { ok: true };
};

export type WorkerRequestType = keyof WorkerRequestPayloadMap;
export type WorkerResponseType = keyof WorkerResponsePayloadMap;

export type WorkerRequestMessage<T extends WorkerRequestType = WorkerRequestType> = {
  kind: 'request';
  requestId: number;
  type: T;
  payload: WorkerRequestPayloadMap[T];
};

export type WorkerSuccessMessage<T extends WorkerResponseType = WorkerResponseType> = {
  kind: 'response';
  requestId: number;
  type: T;
  ok: true;
  payload: WorkerResponsePayloadMap[T];
};

export type WorkerFailureMessage = {
  kind: 'response';
  requestId: number;
  ok: false;
  error: string;
};

export type WorkerEventMessage = {
  kind: 'event';
  type: 'error' | 'log';
  payload: any;
};

export type WorkerIncomingMessage = WorkerRequestMessage;
export type WorkerOutgoingMessage = WorkerSuccessMessage | WorkerFailureMessage | WorkerEventMessage;
