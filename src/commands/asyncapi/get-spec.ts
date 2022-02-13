/**
 * Copyright 2022. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

import { flags } from '@oclif/command';
import { TCBaseCommand, ux } from '@tibco-software/cic-cli-core';
import { APIData, APIList } from '../../models/model';
import * as fs from 'fs';
import * as path from 'path';

export default class AsyncapiGetSpec extends TCBaseCommand {
  static description = 'Pulls spec from new API modeler';

  static flags = {
    ...TCBaseCommand.flags,
    name: flags.string({ char: 'n', description: 'API name in the modeler' }),
  };

  async run() {
    const { args, flags } = this.parse(AsyncapiGetSpec);
    let req = this.getTCRequest();
    let { body: apiList }: { body: APIList } = await req.doRequest('/modeler/v1/getAPIList');
    let apis = apiList.api;
    let apiName = flags.name;
    if (!apiName) {
      apiName = await ux.promptChoicesWithSearch(
        'API Name',
        apis.map((api) => api.apiName)
      );
    }
    let api = apis.find((api) => api.apiName === apiName);
    if (!api) {
      this.error(`Spec with API name ${apiName} could not be found`);
    }
    let { body }: { body: APIData } = await req.doRequest(`/modeler/v1/getAPIData/${api.projectId}/${api.apiId}`);
    let data = JSON.stringify(JSON.parse(body.api.content), null, '  ');
    let filePath = path.join(process.cwd(), 'spec.json');
    fs.writeFileSync(filePath, data);
    this.log(`Spec is stored at location ${filePath}`);
  }
}
