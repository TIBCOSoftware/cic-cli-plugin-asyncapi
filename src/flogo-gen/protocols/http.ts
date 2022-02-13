/**
 * Copyright 2022. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

import * as asyncParser from '@asyncapi/parser';
import { Server } from '@asyncapi/parser';
import { genLoggingTask, genReturnActivity, genSchema, getSampleJSON, initializeFlow } from '../common';
import * as REF from '../constants/references.json';

let flogo: any;
let apiSpec: asyncParser.AsyncAPIDocument;
let server: Server;

export function transform(flogoDescriptor: any, asyncApiSpec: asyncParser.AsyncAPIDocument, serverName: string) {
  flogo = flogoDescriptor;
  apiSpec = asyncApiSpec;
  server = apiSpec.server(serverName);

  flogo.triggers = flogo.triggers || [];
  flogo.resources = flogo.resources || [];
  flogo.schemas = flogo.schemas || {};
  flogo.imports = [];

  buildFlogo();

  return flogo;
}

function buildFlogo() {
  if (!apiSpec.hasChannels()) return;

  let channelNames = apiSpec.channelNames();
  let flowId = 0;
  for (let name of channelNames) {
    let channel = apiSpec.channel(name);
    let flow = initializeFlow(`flow:HTTPFlow${++flowId}`, `HTTPFlow${flowId}`, `HTTPFlow${flowId}`);
    let trigger = genHTTPTrigger(name, channel, flow);
    if (trigger) {
      flow = genHTTPFlow(flow, channel);
      flogo.triggers.push(trigger);
      flogo.resources.push(flow);
    }
  }
}

let triggerId = 0;
function genHTTPTrigger(chlName: string, channel: asyncParser.Channel, flow: any) {
  let op: asyncParser.Operation;

  if (
    channel.publish()?.binding('http')?.type === 'request' ||
    channel.publish()?.binding('https')?.type === 'request'
  ) {
    op = channel.publish();
  } else if (
    channel.subscribe()?.binding('http')?.type === 'request' ||
    channel.subscribe()?.binding('https')?.type === 'request'
  ) {
    op = channel.subscribe();
  } else {
    return;
  }

  let trigger = {
    id: `HTTPTrigger${++triggerId}`,
    ref: REF.TRIGGER.HTTP,
    enableTLS: false,
    certFile: '',
    keyFile: '',
    settings: {
      port: getPort() || 9999,
    },
    handlers: [genHandler(chlName, channel, op, flow)],
  };

  return trigger;
}

function getPort() {
  let url = server.url();
  let regex = /\/\/.*:(.*?)(\/|$)/;
  let op = regex.exec(url);
  if (op == null) {
    return;
  }

  let port = op[1];

  let variableNameRegex = /{(.*?)}/;
  let variableName = variableNameRegex.exec(port);
  if (variableName) {
    return `=$property[${variableName[1]}]`;
  }
  return port;
}

function genHandler(chlName: string, channel: asyncParser.Channel, op: asyncParser.Operation, flow: any) {
  let binding = op.binding('http') || op.binding('https');
  let needsPayload = false;
  if (binding.method.toUpperCase() != 'GET' && binding.method.toUpperCase() != 'DELETE') {
    flogo.schemas[getPayloadName(op.message())] = genSchema(
      op.message().originalPayload(),
      op.message().originalSchemaFormat()
    );
    needsPayload = true;
  }

  let handler: any = {
    settings: {
      Method: binding.method.toUpperCase(),
      Path: chlName,
      reqType: 'application/json',
    },
    action: {
      ref: REF.FLOW,
      settings: {
        flowURI: `res://${flow.id}`,
      },
      input: {
        ...(hasQueryParams(chlName) && { pathParams: '=$.pathParams' }),
        ...(binding.query && { queryParams: '=$.queryParams' }),
        ...(needsPayload && { body: '=$.body' }),
      },
      output: {
        code: '=$.statusCode',
        message: '=$.msg',
      },
    },
    reply: {
      code: 200,
      configureResponseCodes: false,
      message: {},
    },
    schemas: {
      output: {
        queryParams: {
          type: 'json',
          value: JSON.stringify(binding.query),
        },
        headers: {
          type: 'json',
          value: JSON.stringify(op.message()?.headers()),
        },
      },
    },
  };

  if (needsPayload) {
    handler.schemas.output.body = `schema://${getPayloadName(op.message())}`;
  }

  return handler;
}

function hasQueryParams(chlName: string) {
  if (chlName.includes('{') && chlName.includes('}')) return true;
  return false;
}

function getFlowInOuts() {
  let input = [
    {
      name: 'pathParams',
      type: 'Object',
    },
    {
      name: 'queryParams',
      type: 'Object',
    },
    {
      name: 'body',
      type: 'Object',
    },
  ];

  let output = [
    {
      name: 'statusCode',
      type: 'number',
    },
    {
      name: 'msg',
      type: 'string',
    },
  ];

  return { input, output };
}

function genHTTPFlow(flow: any, channel: asyncParser.Channel) {
  flow.data.metadata = {
    input: getFlowInOuts().input,
    output: getFlowInOuts().output,
  };
  let logActivity = genLoggingTask(
    '=string.concat("PATHPARAMS = ",string.tostring($flow.pathParams), "QUERYPARAMS = ", string.tostring($flow.queryParams),"CONTENT = ",string.tostring($flow.body))'
  );

  let response = getResponse(channel);
  let retActivity = genReturnActivity(response);
  flow.data.tasks.push(logActivity, retActivity);

  flow.data.links.push({ from: logActivity.id, to: retActivity.id });

  return flow;
}

function getResponse(channel: asyncParser.Channel) {
  try {
    if (
      channel.subscribe()?.binding('http')?.type == 'response' ||
      channel.subscribe()?.binding('https')?.type == 'response'
    ) {
      let message = channel.subscribe().message();
      let payload = getSampleJSON(message.originalPayload());
      flogo.schemas[getPayloadName(message)] = genSchema(message.originalPayload(), message.originalSchemaFormat());
      return { msg: JSON.stringify(payload), statusCode: 200 };
    }

    let message = channel.publish().message();
    let payload = getSampleJSON(message.originalPayload());
    flogo.schemas[getPayloadName(message)] = genSchema(message.originalPayload(), message.originalSchemaFormat());
    return { msg: JSON.stringify(payload), statusCode: 200 };
  } catch (e) {} //supress errors

  return { msg: 'Request received successfully', statusCode: 200 };
}

function getPayloadName(msg: asyncParser.Message) {
  return msg.uid();
}
