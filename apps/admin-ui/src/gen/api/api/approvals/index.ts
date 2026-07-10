/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../@types';

export type Methods = DefineMethods<{
  get: {
    status: 200;
    resBody: Types.ApprovalWorkflowListResponse;
  };

  post: {
    status: 200;
    resBody: Types.ApprovalWorkflowResponse;
    reqBody: Types.ApprovalMutationRequest;
  };
}>;
