/**
 * Copyright 2022. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

import * as asyncParser from '@asyncapi/parser';
import { initializeFlow, genSchema, getSchemaType, genLoggingTask, toFe_metadata } from '../common';
import * as REF from '../constants/references.json';
import * as JSONSampler from 'openapi-sampler';

let flogo: any;
let apiSpec: asyncParser.AsyncAPIDocument;
let server: asyncParser.Server;

export function transform(flogoDescriptor: any, asyncApiSpec: asyncParser.AsyncAPIDocument, serverName: string) {
  flogo = flogoDescriptor;
  apiSpec = asyncApiSpec;
  flogo.properties = flogo.properties || [];
  flogo.imports = flogo.imports || [];
  flogo.resources = flogo.resources || [];
  flogo.triggers = flogo.triggers || [];
  flogo.schemas = flogo.schemas || {};

  genProducerCase();
  //genWSServerTrigger();

  return flogo;
}

function genProducerCase() {
  if (!apiSpec.hasChannels()) return;

  let chlNames = apiSpec.channelNames();

  for (let chlName of chlNames) {
    let channel = apiSpec.channel(chlName);
    if (!channel.hasSubscribe()) continue;

    let subscribeOp = channel.subscribe();
    let subFlow = genSubFlow(subscribeOp, chlName);
    let mainFlow = genPublishFlow(chlName, channel, subFlow);
    flogo.resources.push(mainFlow, subFlow);

    let trigger = genWsTrigger(chlName, channel, mainFlow);
    flogo.triggers.push(trigger);
  }
}

function genSubFlow(subscribeOp: asyncParser.SubscribeOperation, chlName: string) {
  let flow = initializeFlow(`flow:${chlName}-SubFlow`, `${chlName}-SubFlow`, '');

  flow.data.metadata.input = flowInOuts().input;
  flow.data.metadata.output = flowInOuts().output;
  flow.data.metadata.fe_metadata = toFe_metadata(flow.data.metadata);
  let msgs = subscribeOp.messages();

  let prevTsk = '';

  msgs.forEach((msg) => {
    if (msg.payload().type() == 'object') {
      let schemaName = getSchemaName(msg);
      flogo.schemas[schemaName] = genSchema(msg.originalPayload(), msg.originalSchemaFormat());
    }
    let task = wsWriteTask(msg);

    flow.data.tasks.push(task);

    if (prevTsk) {
      flow.data.links.push({ from: prevTsk, to: task.id });
    }

    prevTsk = task.id;
  });

  return flow;
}

function flowInOuts() {
  let input = [
    {
      name: 'queryParams',
      type: 'object',
    },
    {
      name: 'pathParams',
      type: 'object',
    },
    {
      name: 'wsconnection',
      type: 'any',
    },
    {
      name: 'headers',
      type: 'object',
    },
  ];
  let output: any[] = [];

  return { input, output };
}

function wsWriteTask(msg: asyncParser.Message) {
  let task: any = {};
  task.id = '';
  task.name = '';
  task.desciption = '';
  task.activity = {
    ref: REF.ACTIVITY.WS_WRITE_DATA,
    settings: {},
    input: {},
    schemas: {
      input: {},
    },
  };

  task.activity.input.format = 'String';
  task.activity.input.wsconnection = '=$flow.wsconnection';
  task.activity.input.message = JSONSampler.sample(msg.originalPayload(), { skipNonRequired: false, quiet: true });

  if (msg.payload().type() == 'object') {
    task.activity.settings.format = 'JSON';
    task.activity.settings.jsonSchema = '';
    task.activity.schemas.input.message = `schema://${getSchemaName(msg)}`;
  }

  return task;
}

function genPublishFlow(chlName: string, chl: asyncParser.Channel, subFlow: any) {
  let flow = initializeFlow(`flow:${chlName}-MainFlow`, `${chlName}-MainFlow`, '');
  flow.data.metadata.input = flowInOuts().input;
  flow.data.metadata.output = flowInOuts().output;
  flow.data.metadata.fe_metadata = toFe_metadata(flow.data.metadata);
  let loggingTsk = genLoggingTask(
    '=string.concat(string.tostring($flow.pathParams),"\\n", string.tostring($flow.queryParams))'
  );

  let subFlowTsk = genSubFlowTsk(subFlow);
  flow.data.tasks.push(loggingTsk, subFlowTsk);
  flow.data.links = [
    {
      from: loggingTsk.id,
      to: subFlowTsk.id,
      type: 'default',
    },
  ];

  return flow;
}

function genSubFlowTsk(subFlow: any) {
  let task: any = {
    id: 'StartaSubFlow',
    name: 'StartaSubFlow',
    description: 'Simple SubFlow Activity',
    type: 'doWhile',
    settings: {
      doWhile: {
        condition: '=$iteration[index] != -1',
        delay: 3000,
        accessOutputInInput: false,
      },
      accumulate: false,
    },
    activity: {
      ref: REF.ACTIVITY.SUBFLOW,
      settings: {
        flowURI: `res://${subFlow.id}`,
      },
      input: {
        queryParams: '=$flow.queryParams',
        pathParams: '=$flow.pathParams',
        wsconnection: '=$flow.wsconnection',
      },
    },
  };

  return task;
}

function getSchemaName(msg: asyncParser.Message) {
  return msg.uid();
}

let wsServerId = 0;
let serverPort = 9997;
function genWsTrigger(chlName: string, chl: asyncParser.Channel, flow: any) {
  let trigger = {
    id: `WebsocketServer${++wsServerId}`,
    ref: REF.TRIGGER.WS_SERVER,
    name: 'wsserver',
    description: 'Websocket server listens for connection request from the client',
    settings: {
      port: ++serverPort,
      enableTLS: false,
      serverCert: '',
      serverKey: '',
      enableClientAuth: false,
      trustStore: '',
    },
    handlers: [genWsTriggerHandler(chlName, chl, flow)],
  };

  return trigger;
}

function genWsTriggerHandler(chlName: string, chl: asyncParser.Channel, flow: any) {
  let handler: any = {
    settings: {},
    action: {
      ref: REF.FLOW,
      settings: {
        flowURI: `res://${flow.id}`,
      },
      input: {},
      output: {},
    },
    schemas: {
      output: {},
    },
  };

  handler.settings.path = chlName;
  if (chl.hasPublish()) {
    console.log('For future');
  } else {
    handler.settings.method = 'GET';
    handler.settings.mode = 'Connection';
    handler.settings.format = 'String';
  }

  handler.action.input = {
    pathParams: chl.hasParameters() ? '=$.pathParams' : {},
    headers: '=$.headers',
    wsconnection: '=$.wsconnection',
    queryParams: {},
  };

  if (chl.hasBindings() && chl.binding('ws').query) {
    let query = chl.binding('ws').query;

    handler.schemas.output.queryParams = {
      type: 'json',
      value: JSON.stringify(query),
      fe_metadata: getQueryParamsFe_metadata(query),
    };

    handler.action.input.queryParams = '=$.queryParams';
  }

  return handler;
}

function getQueryParamsFe_metadata(schema: any) {
  let fe_metadata: any = [];

  let properties = schema.properties;
  for (let prop in properties) {
    let obj: any = {};
    obj.parameterName = prop;
    if (properties[prop].type == 'number' || properties[prop].type == 'boolean') {
      obj.type = properties[prop].type;
    } else {
      obj.type = 'string';
    }
    obj.repeating = false;
    obj.required = schema?.required?.includes(prop) || false;

    fe_metadata.push(obj);
  }

  return JSON.stringify(fe_metadata);
}
