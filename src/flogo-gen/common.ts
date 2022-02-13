/**
 * Copyright 2022. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

import * as REF from './constants/references.json';
import * as asyncParser from '@asyncapi/parser';
import * as JSONSampler from 'openapi-sampler';
export function initializeFlow(id: string, name: string, description?: string) {
  let flow = {
    id: id,
    data: {
      name: name,
      description: description || '',
      links: [],
      tasks: [],
      metadata: {
        input: [],
        output: [],
      },
    },
  };
  return flow as any;
}

export function genSchema(schema: any, type: string) {
  return {
    type: getSchemaType(type),
    value: JSON.stringify(schema, null, '  '),
    fe_metadata: JSON.stringify(schema, null, ' '),
  };
}

export function getSchemaType(type: string) {
  let avroSchemaFormats = [
    'application/vnd.apache.avro;version=1.9.0',
    'application/vnd.apache.avro+json;version=1.9.0',
    'application/vnd.apache.avro+yaml;version=1.9.0',
  ];

  let jsonSchemaFormats = ['application/schema+json;version=draft-07', 'application/schema+yaml;version=draft-07'];

  if (avroSchemaFormats.includes(type)) {
    return 'avro';
  } else {
    return 'json';
  }
}

let logId = 0;
export function genLoggingTask(message: string) {
  return {
    id: `Log${++logId}`,
    name: 'Log',
    description: 'Logs a message',
    activity: {
      ref: REF.ACTIVITY.LOG,
      input: {
        message: message,
        addDetails: false,
        usePrint: false,
      },
    },
  };
}

export function getPort(server: asyncParser.Server) {
  let url = server.url();
  let regex = /\/\/.*:(.*?)(\/|$)/;
  let op = regex.exec(url);
  if (op == null) {
    return '';
  }

  let port = op[1];

  let variableNameRegex = /{(.*?)}/;
  let variableName = variableNameRegex.exec(port);
  if (variableName) {
    port = `=$property[${variableName[1]}]`;
  }

  return port;
}

export function toFe_metadata(metadata: { input: any[]; output: any[] }) {
  let input: any = {
    $schema: 'http://json-schema.org/draft-04/schema#',
    type: 'object',
    properties: {},
  };

  // deep clone
  let output = JSON.parse(JSON.stringify(input));

  metadata.input.forEach((obj) => {
    input.properties[obj.name] = {
      type: obj.type,
      properties: {},
    };
  });

  metadata.output.forEach((obj) => {
    output.properties[obj.name] = {
      type: obj.type,
      properties: {},
    };
  });

  return { input: JSON.stringify(input), output: JSON.stringify(output) };
}
let timerTriggerId = 0;
export function genTimerTrigger(time: number, unit: 'Second' | 'Hour' | 'Week' | 'Minute' | 'Day', flowId: string) {
  return {
    ref: REF.TRIGGER.TIMER,
    name: 'tibco-wi-timer',
    description: 'Simple Timer trigger',
    settings: {},
    id: `TimerTrigger${++timerTriggerId}`,
    handlers: [
      {
        description: 'Producer flow',
        settings: {
          Repeating: true,
          'Start Date': '',
          'Time Interval': time,
          'Interval Unit': unit,
        },
        action: {
          ref: REF.FLOW,
          settings: {
            flowURI: `res://${flowId}`,
          },
        },
        name: flowId,
      },
    ],
  };
}

let returnId = 0;
export function genReturnActivity(output?: any) {
  return {
    id: `ReturnActivity${++returnId}`,
    name: 'Return',
    description: 'Simple Return Activity',
    activity: {
      ref: REF.ACTIVITY.RETURN,
      settings: {
        mappings: output,
      },
    },
  };
}

export function getSampleJSON(schema: any) {
  return JSONSampler.sample(schema, { quiet: true, skipNonRequired: false });
}

export function isCompatible() {}
