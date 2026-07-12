import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
  isImageOptimizationPath,
} from "vinext/server/image-optimization";
import type { ImageConfig } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

const imageConfig: ImageConfig = {
  deviceSizes: JSON.parse(
    process.env.__VINEXT_IMAGE_DEVICE_SIZES ??
      JSON.stringify(DEFAULT_DEVICE_SIZES),
  ),
  imageSizes: JSON.parse(
    process.env.__VINEXT_IMAGE_SIZES ?? JSON.stringify(DEFAULT_IMAGE_SIZES),
  ),
  qualities:
    JSON.parse(process.env.__VINEXT_IMAGE_QUALITIES ?? "null") ??
    undefined,
  dangerouslyAllowSVG:
    process.env.__VINEXT_IMAGE_DANGEROUSLY_ALLOW_SVG === "true",
};

interface Env {
  ASSETS: Fetcher;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
  [key: string]: unknown;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const runtimeGlobal = globalThis as typeof globalThis & {
      __env__?: Record<string, string>;
      __workerAssets__?: Pick<Fetcher, "fetch">;
    };
    runtimeGlobal.__env__ = Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    runtimeGlobal.__workerAssets__ = env.ASSETS;

    const url = new URL(request.url);

    if (isImageOptimizationPath(url.pathname)) {
      const allowedWidths = [
        ...(imageConfig.deviceSizes ?? DEFAULT_DEVICE_SIZES),
        ...(imageConfig.imageSizes ?? DEFAULT_IMAGE_SIZES),
      ];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
        imageConfig,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};
