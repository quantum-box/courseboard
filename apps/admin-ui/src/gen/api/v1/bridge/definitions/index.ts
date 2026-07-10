/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../@types';

export type Methods = DefineMethods<{
  get: {
    status: 200;
    /** Bridge definition list */
    resBody: Types.BridgeDefinitionListResponse;
  };

  post: {
    status: 201;
    /** Bridge definition created */
    resBody: Types.BridgeDefinitionResponse;
    reqBody: Types.BridgeDefinitionRequest;
  };
}>;
