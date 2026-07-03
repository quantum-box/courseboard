/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../@types';

export type Methods = DefineMethods<{
  get: {
    status: 200;
    resBody: Types.ApprovalFlowListResponse;
  };

  post: {
    status: 201;
    resBody: Types.ApprovalFlowResponse;
    reqBody: Types.CreateApprovalFlowRequest;
  };
}>;
