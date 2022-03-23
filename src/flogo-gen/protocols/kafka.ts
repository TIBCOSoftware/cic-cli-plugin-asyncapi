/**
 * Copyright 2022. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

import * as asyncParser from '@asyncapi/parser';
import * as REF from '../constants/references.json';
import { genLoggingTask, genSchema, getSchemaType, getSampleJSON, initializeFlow } from '../common';

let flogo: any;
let apiSpec: asyncParser.AsyncAPIDocument;

const DEFAULT_PROPERTIES = [
  {
    name: 'connection-timeout',
    type: 'float64',
    value: 30,
  },
  {
    name: 'retry-backoff',
    type: 'float64',
    value: 250,
  },
];

const DEFAULT_CONNECTIONS = {
  id: 'eeb7ac70-fb67-11eb-bb64-29345b27412e',
  name: 'kafka-client-sample',
  ref: REF.CONNECTOR.KAFKA,
  isGlobal: false,
  settings: {
    name: 'kafka-client-sample',
    description: 'Apache Kafka client configuration',
    brokers: '=$property["broker-urls"]',
    authMode: 'None',
    userName: '',
    password: '',
    securityProtocol: 'SASL_SSL',
    clientCert: '',
    clientKey: '',
    caCert: '',
    connectionTimeout: '=$property["connection-timeout"]',
    retryBackoff: '=$property["retry-backoff"]',
    retryMax: 3,
    refreshFrequency: 40,
    useSchmaRegistry: false,
    url: '',
    userName_schemaRegistry: '',
    password_schemaRegistry: '',
  },
};

export function transform(flogoDescriptor: any, asyncApiSpec: asyncParser.AsyncAPIDocument, serverNames: string[]) {
  flogo = flogoDescriptor;
  apiSpec = asyncApiSpec;

  flogo.properties = [
    ...flogo.properties,
    ...DEFAULT_PROPERTIES,
    { name: 'broker-urls', type: 'string', value: getBrokerUrls(serverNames).join() },
  ];
  flogo.connections = genConnections();
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
        //       let trigger = genTimerTrigger(5, 'Second', flow.id);
        flogo.resources.push(flow);
        //       flogo.triggers.push(trigger);
      }
    }
    if (channel.hasPublish()) {
      let flow = genConsumerFlow(name, channel);

      if (flow) {
        let trigger = genKafkaTrigger(name, channel, flow.id);
        flogo.resources.push(flow);
        flogo.triggers.push(trigger);
      }
    }
  }
}

function getBrokerUrls(serverNames: string[]) {
  let urls: string[] = [];
  serverNames.forEach((name) => {
    let server = apiSpec.server(name);
    let variableRegex = /{(.*?)}/g;
    let url = server.url().replace(variableRegex, (a, variable) => {
      return server.variable(variable).defaultValue() || server.variable(variable).allowedValues()[0];
    });

    urls.push(url);
  });

  return urls;
}

function genConnections() {
  let connection = DEFAULT_CONNECTIONS;
  let id = getConnId();
  connection.id = id;
  connection.name = id;
  let temp: any = {};
  temp[id] = connection;
  return temp;
}

let pubFlowId = 0;
function genPublisherFlow(chlName: string, channel: asyncParser.Channel) {
  if (!channel.subscribe().message()) return;

  let flow = initializeFlow(`flow:flow_${++pubFlowId}`, `Channel ${chlName} data publisher`, `Publish data on channel`);

  let schemaName = '';

  let message = channel.subscribe().message();
  if (message.payload().type() == 'object' || message.payload().type() == 'array') {
    let schema = genSchema(message.originalPayload(), message.originalSchemaFormat());
    schemaName = getPayloadName(message);
    flogo.schemas[schemaName] = schema;
  }

  let task = genKafkaProducer(message, chlName, schemaName);

  flow.data.tasks.push(task);

  return flow;
}

function genKafkaProducer(message: asyncParser.Message, chlName: string, schemaName: string) {
  let task: any = {};
  task.id = `publish-to-${chlName}`;
  task.name = `publish-to-${chlName}`;
  task.description = `Publish sample data to channel ${chlName}`;

  task.activity = {
    ref: REF.ACTIVITY.KAFKA,
    input: {
      kafkaConnection: `conn://${getConnId()}`,
      ackMode: 'None',
      ackTimeout: 10000,
      compressionType: 'None',
      key: '',
      subjects: 'String',
      versions: 1,
      partition: 0,
      maxRequestSize: 1048576,
      maxMessages: 0,
      frequency: 1000,
      topic: chlName,
    },
    schemas: {
      input: {},
    },
  };

  let type, inputValKey;

  if (message.payload().type() == 'object' || message.payload().type() == 'array') {
    type = getSchemaType(message.originalSchemaFormat());
    inputValKey = type === 'json' ? type + 'Value' : type + 'Data';
    task.activity.schemas.input[inputValKey] = `schema://${schemaName}`;
    task.activity.input.valueType = type.toUpperCase();
    let val = getProducerValue(message, type);
    task.activity.input[inputValKey] = val;
  } else {
    task.activity.input.valueType = 'String';
    let val = getProducerValue(message, 'string');
    task.activity.input['stringValue'] = `=string.tostring(${val})`;
  }

  return task;
}

function getProducerValue(message: asyncParser.Message, schemaType: string) {
  if (schemaType === 'json' || schemaType === 'string') {
    return getSampleJSON(message.originalPayload());
  }
}

function genConsumerFlow(chlName: string, channel: asyncParser.Channel) {
  if (!channel.publish().message()) return;

  let flowId = `flow:demo_${chlName}_consumer_flow`;
  let flowDescription = `Act when data received from  channel ${chlName}`;
  let flowName = `Channel ${chlName} consumer`;
  let flow = initializeFlow(flowId, flowName, flowDescription);

  let message = channel.publish().message();

  let payloadName = getPayloadName(message);

  if (message.payload().type() != 'object' || message.payload().type() != 'array') {
    flow.data.metadata.input.push(
      {
        name: payloadName,
        type: 'string',
      },
      { name: 'chlName', type: 'string' }
    );
  } else {
    let schema = genSchema(message.originalPayload(), message.originalSchemaFormat());

    flogo.schemas[payloadName] = schema;
    flow.data.metadata.input.push(
      {
        name: payloadName,
        type: message.payload().type(),
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

let kafkaId = 0;
function genKafkaTrigger(chlName: string, channel: asyncParser.Channel, flowId: string) {
  let trigger: any = {
    ref: REF.TRIGGER.KAFKA,
    name: 'kafka-consumer-trigger',
    description: 'Subscribe to Kafka topic',
    settings: {
      kafkaConnection: `conn://${getConnId()}`,
    },
    id: `KafkaConsumer${++kafkaId}`,
    handlers: [],
  };

  let handler = genKafkaHandler(chlName, channel, flowId);
  trigger.handlers.push(handler);
  return trigger;
}

function genKafkaHandler(chlName: string, channel: asyncParser.Channel, flowId: string) {
  let message = channel.publish().message();
  let schemaFormat = message.originalSchemaFormat();
  let type = getSchemaType(schemaFormat);
  let dataType: string;

  if (message.payload().type() != 'object' || message.payload().type() != 'array') {
    dataType = 'String';
    type = 'String';
  } else {
    dataType = type.toUpperCase();
  }

  let handler: any = {
    description: `Triggers when data received from channel ${chlName}`,
    settings: {
      topic: chlName,
      topicPattern: '',
      consumerGroup: getConsumerGrpId(channel.publish()),
      valueType: dataType, // String | JSON | AVRO
      subjects: 'String',
      versions: 1,
      commitInterval: 5000,
      initialOffset: 'Oldest',
      fetchMinBytes: 1,
      fetchMaxWait: 500,
      heartbeatInterval: 3000,
      sessionTimeout: 30000,
    },
    action: {
      ref: REF.FLOW,
      settings: {
        flowURI: `res://${flowId}`,
      },
      input: {},
    },
    schemas: {},
    name: 'flow',
  };

  let inputVal = `=$trigger.${type.toLowerCase()}Value`;

  let input: any = {
    [getPayloadName(message)]: inputVal,
    chlName: chlName,
  };

  handler.action.input = input;

  if (message.payload().type() == 'object' || message.payload().type() == 'array') {
    let schemas: any = {
      output: {
        [`${type}Value`]: `schema://${getPayloadName(message)}`, // reference to schema name
      },
    };

    handler.schemas = schemas;
  }

  return handler;
}

function getConsumerGrpId(publishOp: asyncParser.PublishOperation) {
  if (publishOp.hasBinding('kafka')) {
    let kafkaBindings = publishOp.binding('kafka');
    if (hasGroupId(kafkaBindings)) {
      return kafkaBindings.groupId.default || kafkaBindings.groupId.enum[0];
    }
    return 'test-consumer-group';
  }
  return 'test-consumer-group';
}

function hasGroupId(kafkaBindings: any) {
  if (kafkaBindings.groupId.default) {
    return true;
  }
  if (kafkaBindings.groupId.enum[0]) {
    return true;
  }
  return false;
}

function getPayloadName(msg: asyncParser.Message) {
  return msg.uid();
}

function getConnId() {
  if (apiSpec.id()) return `kafka-connection-for-${apiSpec.id()}`;
  else return `kafka-connection-for-${apiSpec.info().title().replace(/\s+/g, '-')}`;
}
