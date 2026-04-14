import * as THREE from 'three';

type TextureLoadCallback = (texture: THREE.Texture) => void;
type TextureErrorCallback = (error: any) => void;

function hasDocumentEnvironment(): boolean {
  return typeof document !== 'undefined' && typeof document.createElementNS === 'function';
}

import { resolveTextureUrlForWorker } from './path_utils';

var placeholderImage: ImageBitmap | null = null;

function getPlaceholderImage(): ImageBitmap | null {
  if (placeholderImage) {
    return placeholderImage;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      var canvas = new OffscreenCanvas(1, 1);
      // A rendering context must be acquired before transferToImageBitmap()
      // can be called; without it the browser throws InvalidStateError.
      var ctx = canvas.getContext('2d');
      if (ctx) {
        placeholderImage = canvas.transferToImageBitmap();
      }
    } catch (_) {
      // Placeholder is optional — texture will update when the fetch resolves.
    }
  }
  return placeholderImage;
}

export function loadTextureCompat(
  url: string,
  onLoad?: TextureLoadCallback,
  onError?: TextureErrorCallback
): THREE.Texture {
  if (hasDocumentEnvironment()) {
    return new THREE.TextureLoader().load(
      url,
      (texture) => {
        if (onLoad) {
          onLoad(texture);
        }
      },
      undefined,
      (error) => {
        if (onError) {
          onError(error);
        } else {
          console.error(`Failed to load texture "${url}"`, error);
        }
      }
    );
  }

  var texture = new THREE.Texture();
  // Assign a placeholder immediately to prevent WebGPURenderer from 
  // crashing when it tries to update a texture with null image.
  var placeholder = getPlaceholderImage();
  if (placeholder) {
    texture.image = placeholder as unknown as HTMLImageElement;
  }

  var workerUrl = resolveTextureUrlForWorker(url);

  fetch(workerUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${workerUrl}`);
      }
      return response.blob();
    })
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => {
      texture.image = bitmap as unknown as HTMLImageElement;
      texture.needsUpdate = true;
      if (onLoad) {
        onLoad(texture);
      }
    })
    .catch((error) => {
      if (onError) {
        onError(error);
      } else {
        console.error(`Failed to load texture "${workerUrl}"`, error);
      }
    });

  return texture;
}
