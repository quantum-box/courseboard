/* eslint-disable */
import type { DefineMethods } from 'aspida';

export type Methods = DefineMethods<{
  /** Returns 200 when all dependencies are healthy, 503 otherwise. */
  get: {
    status: 200;
  };
}>;
