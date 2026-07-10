/* eslint-disable */
import type { DefineMethods } from 'aspida';
import type * as Types from '../../../../@types';

export type Methods = DefineMethods<{
  delete: {
    status: 204;
  };

  get: {
    status: 200;
    resBody: Types.ApprovalFlowResponse;
  };

  put: {
    status: 200;
    resBody: Types.ApprovalFlowResponse;
    reqBody: Types.UpdateApprovalFlowRequest;
  };
}>;
