import type {
  CameraState,
  SceneCommand,
  WorkerIncomingMessage,
  WorkerInitPayload,
  WorkerOutgoingMessage,
  WorkerRequestPayloadMap,
  WorkerRequestType,
  WorkerResponsePayloadMap
} from '../../src/worker/protocol';

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: any) => void;
};

export class SceneWorkerClient {
  private worker: Worker;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor() {
    this.worker = new Worker(new URL('../../src/worker/scene.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
      const message = event.data;
      if (!message) {
        return;
      }
      if (message.kind === 'event') {
        if (message.type === 'error') {
          console.error('[scene-worker]', message.payload);
        }
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) {
        return;
      }
      this.pending.delete(message.requestId);
      if (!message.ok) {
        pending.reject(new Error(message.error));
        return;
      }
      pending.resolve(message.payload);
    };
  }

  public init(payload: WorkerInitPayload): Promise<WorkerResponsePayloadMap['init']> {
    return this.request('init', payload, [payload.canvas]);
  }

  public resize(payload: WorkerRequestPayloadMap['resize']): Promise<WorkerResponsePayloadMap['resize']> {
    return this.request('resize', payload);
  }

  public loadSerialized(
    serialized: string,
    recordHistory = false,
    centerCamera = false
  ): Promise<WorkerResponsePayloadMap['load_serialized']> {
    return this.request('load_serialized', { serialized, recordHistory, centerCamera });
  }

  public setCamera(camera: CameraState): Promise<WorkerResponsePayloadMap['set_camera']> {
    return this.request('set_camera', { camera });
  }

  public centerCamera(): Promise<WorkerResponsePayloadMap['center_camera']> {
    return this.request('center_camera', {});
  }

  public applySceneCommand(
    command: SceneCommand,
    recordHistory = true
  ): Promise<WorkerResponsePayloadMap['apply_scene_command']> {
    return this.request('apply_scene_command', { command, recordHistory });
  }

  public applySceneCommands(
    commands: SceneCommand[],
    recordHistory = true
  ): Promise<WorkerResponsePayloadMap['apply_scene_commands']> {
    return this.request('apply_scene_commands', { commands, recordHistory });
  }

  public exportSerialized(): Promise<WorkerResponsePayloadMap['export_serialized']> {
    return this.request('export_serialized', {});
  }

  public getHistoryState(): Promise<WorkerResponsePayloadMap['get_history_state']> {
    return this.request('get_history_state', {});
  }

  public undo(): Promise<WorkerResponsePayloadMap['undo']> {
    return this.request('undo', {});
  }

  public redo(): Promise<WorkerResponsePayloadMap['redo']> {
    return this.request('redo', {});
  }

  public async dispose() {
    try {
      await this.request('dispose', {});
    } catch (_) {
      // Worker could already be terminated.
    }
    this.worker.terminate();
    this.pending.forEach(({ reject }) => reject(new Error('Scene worker disposed')));
    this.pending.clear();
  }

  private request<T extends WorkerRequestType>(
    type: T,
    payload: WorkerRequestPayloadMap[T],
    transferables?: Transferable[]
  ): Promise<WorkerResponsePayloadMap[T]> {
    const requestId = this.nextRequestId++;
    const message: WorkerIncomingMessage = {
      kind: 'request',
      requestId,
      type,
      payload
    };
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      if (transferables && transferables.length > 0) {
        this.worker.postMessage(message, transferables);
      } else {
        this.worker.postMessage(message);
      }
    });
  }
}
