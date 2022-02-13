/**
 * Copyright 2022. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

import * as asyncParser from '@asyncapi/parser';
import * as REF from '../constants/references.json';

import { genTimerTrigger, initializeFlow, genSchema, getSampleJSON, genLoggingTask } from '../common';

let flogo: any;
let apiSpec: asyncParser.AsyncAPIDocument;
let server: asyncParser.Server;
export function transform(flogoDescriptor: any, asyncApiSpec: asyncParser.AsyncAPIDocument, serverName: string) {
  flogo = flogoDescriptor;
  apiSpec = asyncApiSpec;
  server = apiSpec.server(serverName);
  flogo.properties = [...flogo.properties];
  let url = getBrokerUrl(serverName);
  flogo.connections = genConnection(url);
  flogo.imports = flogo.imports || [];
  flogo.resources = flogo.resources || [];
  flogo.triggers = flogo.triggers || [];
  flogo.schemas = flogo.schemas || {};

  buildFlogo();

  return flogo;
}

function buildFlogo() {
  if (!apiSpec.hasChannels()) return;

  let channelNames = apiSpec.channelNames();

  for (let name of channelNames) {
    let channel = apiSpec.channel(name);

    if (channel.hasSubscribe()) {
      let flow = genPublisherFlow(name, channel);

      if (flow) {
        let trigger = genTimerTrigger(5, 'Second', flow.id);
        flogo.resources.push(flow);
        flogo.triggers.push(trigger);
      }
    }
    if (channel.hasPublish()) {
      let flow = genConsumerFlow(name, channel);

      if (flow) {
        let trigger = genMqttTrigger(name, channel, flow.id);
        flogo.resources.push(flow);
        flogo.triggers.push(trigger);
      }
    }
  }
}

let pubFlowId = 0;
function genPublisherFlow(chlName: string, channel: asyncParser.Channel) {
  if (!channel.subscribe().message()) return;

  let flow: any = initializeFlow(
    `flow:flow_${++pubFlowId}`,
    `Channel ${chlName} data publisher`,
    `Publish data on channel`
  );

  let schemaName = '';

  let message = channel.subscribe().message();
  if (message.payload().type() == 'object') {
    let schema = genSchema(message.originalPayload(), message.originalSchemaFormat());
    schemaName = getPayloadName(message);
    flogo.schemas[schemaName] = schema;
  }

  // Generate Flow Activity
  let task = genProducerTask(message, chlName, channel.subscribe(), schemaName);

  flow.data.tasks.push(task);

  return flow;
}

function getConnId() {
  if (apiSpec.info()) return `mqtt-connection-for-${apiSpec.id()}`;
  else return `mqtt-connection-for-${apiSpec.info().title().replace(/\s+/g, '-')}`;
}

function getBrokerUrl(name: string) {
  let server = apiSpec.server(name);
  let variableRegex = /{(.*?)}/g;
  let url = server.url().replace(variableRegex, (a, variable) => {
    return server.variable(variable).defaultValue() || server.variable(variable).allowedValues()[0];
  });

  return url;
}

function genProducerTask(
  msg: asyncParser.Message,
  chlName: string,
  subscribeOp: asyncParser.SubscribeOperation,
  schemaName: string
) {
  let retainVal = subscribeOp.binding('mqtt')?.retain || msg.binding('mqtt')?.retain || false;
  let qosVal = subscribeOp.binding('mqtt')?.qos || msg.binding('mqtt')?.qos || 0;
  let task: any = {
    id: `publish-to-${chlName}`,
    name: `publish-to-${chlName}`,
    description: 'An MQTT message publisher',
    activity: {
      ref: REF.ACTIVITY.MQTT,
      input: {
        Connection: `conn://${getConnId()}`,
        topic: chlName,
        retain: retainVal,
        qos: qosVal,
        valueType: 'JSON',
        stringValue: '',
        jsonValue: {},
      },
      schemas: {
        input: {},
      },
    },
  };

  if (msg.payload().type() == 'object') {
    task.activity.input.valueType = 'JSON';
    task.activity.input.jsonValue = getSampleJSON(msg.originalPayload());
    task.activity.schemas.input = {
      jsonValue: `schema://${schemaName}`,
    };
  } else {
    task.activity.input.valueType = 'String';
    task.activity.input.stringValue = `=string.tostring(${getSampleJSON(msg.originalPayload())})`;
  }

  return task;
}

let mqttId = 0;
function genMqttTrigger(chlName: string, channel: asyncParser.Channel, flowId: string) {
  let trigger: any = {
    ref: REF.TRIGGER.MQTT,
    name: 'mqtt-trigger',
    description: 'Subscribe to an MQTT topic',
    settings: {
      mqttConnection: `conn://${getConnId()}`,
    },
    id: `MQTTSubscriber${++mqttId}`,
    handlers: [],
  };

  let handler = genMqttHandler(chlName, channel, flowId);
  trigger.handlers.push(handler);
  return trigger;
}

function genMqttHandler(chlName: string, channel: asyncParser.Channel, flowId: string) {
  let msg = channel.publish().message();

  let showwillVal = server.binding('mqtt')?.lastWill ? true : false;
  let willqosVal = server.binding('mqtt')?.lastWill?.qos || 0;
  let willVal = server.binding('mqtt')?.lastWill?.message || '';
  let willtopicVal = server.binding('mqtt')?.lastWill?.topic || '';
  let willretainVal = server.binding('mqtt')?.lastWill?.retain || false;

  let handler: any = {
    description: '',
    settings: {
      topic: chlName,
      qos: channel.publish().binding('mqtt')?.qos || msg.binding('mqtt')?.qos || 0,
      showwill: showwillVal,
      will: willVal,
      willtopic: willtopicVal,
      willqos: willqosVal,
      willretain: willretainVal,
    },
    action: {
      ref: REF.FLOW,
      settings: {
        flowURI: `res://${flowId}`,
      },
      input: {},
    },
    schemas: {},

    name: '',
  };

  if (msg.payload().type() == 'object') {
    handler.action.input[getPayloadName(msg)] = '=$trigger.jsonValue';
    handler.settings.valueType = 'JSON';
    handler.schemas.output = {
      jsonValue: `schema://${getPayloadName(msg)}`,
    };
  } else {
    handler.action.input[getPayloadName(msg)] = '=$trigger.stringValue';
    handler.settings.valueType = 'String';
  }

  return handler;
}

function genConsumerFlow(chlName: string, channel: asyncParser.Channel) {
  if (!channel.publish().message()) return;

  let flowId = `flow:demo_${chlName}_consumer_flow`;
  let flowDescription = `Receive data from channel`;
  let flowName = `Channel ${chlName} consumer`;
  let flow = initializeFlow(flowId, flowName, flowDescription);

  let message = channel.publish().message();

  let payloadName = getPayloadName(message);

  if (message.payload().type() != 'object') {
    flow.data.metadata.input.push(
      {
        name: payloadName,
        type: message.payload().type(),
      },
      { name: 'chlName', type: 'string' }
    );
  } else {
    let schema = genSchema(message.originalPayload(), message.originalSchemaFormat());

    flogo.schemas[payloadName] = schema;
    flow.data.metadata.input.push(
      {
        name: payloadName,
        type: 'string',
        schema: `schema://${payloadName}`,
      },
      { name: 'chlName', type: 'string' }
    );
  }

  let loggingMsg = `=string.concat("Message from channel ${chlName}: \\n",string.tostring($flow.${payloadName}))`;
  let logTsk = genLoggingTask(loggingMsg);

  flow.data.tasks.push(logTsk);

  return flow;
}

function getPayloadName(msg: asyncParser.Message) {
  return msg.uid();
}

function genConnection(brokerUrl: string) {
  let connId = getConnId();
  let connection: any = {
    id: connId,
    name: connId,
    ref: REF.CONNECTOR.MQTT,
    isGlobal: false,
    settings: {
      name: connId,
      description: connId,
      broker: brokerUrl,
    },
  };

  let temp: any = {};
  temp[connId] = connection;
  return temp;
}
