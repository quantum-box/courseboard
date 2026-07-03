/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../@types';

export type Methods = DefineMethods<{
  post: {
    status: 200;
    /** Bridge action availability */
    resBody: Types.BridgeActionResponse;
    reqBody: Types.BridgeActionRequest;
  };
}>;
