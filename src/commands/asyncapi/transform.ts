/**
 * Copyright 2022. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

import { flags } from '@oclif/command';
import { genFlogoModel } from '../../flogo-gen/main';
import { BaseCommand } from '@tibco-software/cic-cli-core';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export default class TransformCommand extends BaseCommand {
  static description = 'Transform AsyncAPI spec to Flogo Or Flogo to AsyncAPI spec';

  static examples = [`tibco asyncapi:transform --to flogo --from ./asyncapispec.json`];

  static flags = {
    ...BaseCommand.flags,
    to: flags.string({
      char: 't',
      description: 'conversion type',
      options: ['flogo', 'asyncapi'],
      default: 'flogo',
    }),

    from: flags.string({
      char: 'f',
      description: 'Path to the source file',
      required: true,
      parse: (input) => input.trim(),
    }),

    server: flags.string({
      char: 's',
      description: 'Server name in asyncapi spec. Comma separated servers incase of Kafka Cluster',
      required: true,
    }),
  };

  async run() {
    const { args, flags } = this.parse(TransformCommand);
    let app;

    let source = flags.from.replace('~', () => process.env.HOME as string);

    let doc: any;

    doc = this.try(() => fs.readFileSync(source, { encoding: 'utf-8' }), `Failed to read file at location ${source}`);

    let fileExt = path.extname(source);
    if (fileExt === '.yaml' || fileExt === '.yml') {
      doc = yaml.load(doc);
    } else {
      doc = this.try(() => JSON.parse(doc), `Invalid JSON format`);
    }

    if (flags.to === 'flogo') {
      try {
        app = await genFlogoModel(doc, flags.server);
      } catch (error) {
        this.debug(error);
        this.error((error as Error).message);
      }
      if (app) {
        let destn = path.join(process.cwd(), 'flogo.json');
        fs.writeFileSync(destn, JSON.stringify(app, null, '  '));
        this.log(`Created flogo.json file successfully at location ${destn}`);
      }
    }
  }

  try(func: () => any, errMsg: string) {
    try {
      return func();
    } catch (err) {
      //  this.debug(err);
      this.error(errMsg);
    }
  }
}
