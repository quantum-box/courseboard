declare module "vinext/server/app-router-entry" {
  const handler: {
    fetch(
      request: Request,
      env: unknown,
      ctx: unknown,
    ): Promise<Response>;
  };

  export default handler;
}

declare module "vinext/server/image-optimization" {
  export interface ImageConfig {
    deviceSizes?: number[];
    imageSizes?: number[];
    qualities?: number[];
    dangerouslyAllowSVG?: boolean;
  }

  export const DEFAULT_DEVICE_SIZES: number[];
  export const DEFAULT_IMAGE_SIZES: number[];

  export function isImageOptimizationPath(pathname: string): boolean;

  export function handleImageOptimization(
    request: Request,
    options: {
      fetchAsset(path: string): Response | Promise<Response>;
      transformImage(
        body: ReadableStream,
        options: { width: number; format: string; quality: number },
      ): Promise<Response>;
    },
    allowedWidths: number[],
    imageConfig: ImageConfig,
  ): Promise<Response>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
