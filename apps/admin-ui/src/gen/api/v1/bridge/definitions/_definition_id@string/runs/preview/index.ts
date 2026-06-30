/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../../../@types';

export type Methods = DefineMethods<{
  post: {
    status: 200;
    /** Existing idempotent Bridge run preview */
    resBody: Types.BridgeRunResponse;
    reqBody: Types.BridgeRunPreviewRequest;
  };
}>;
