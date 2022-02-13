/**
 * Copyright 2022. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

export interface APIMetadata {
  apiName: string;
  version: string;
  userName: string;
  email: string;
  apiType: string;
  projectId: string;
  apiId: string;
}

export interface APIList {
  message: string;
  api: APIMetadata[];
}

export interface APIData {
  message: string;
  api: API;
}

export interface API {
  apiName: string;
  version: string;
  content: string;
  userName: string;
  email: string;
  apiType: string;
  projectId: string;
  apiId: string;
}
