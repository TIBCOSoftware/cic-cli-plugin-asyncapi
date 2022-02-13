/**
 * Copyright 2022. TIBCO Software Inc.
 * This file is subject to the license terms contained
 * in the license file that is distributed with this file.
 */

import * as asyncParser from '@asyncapi/parser';

const TYPE = 'flogo:app';
const APP_MODEL = '1.1.0';
let apiSpec: asyncParser.AsyncAPIDocument;
export async function genFlogoModel(input: any, serverNames?: string) {
  apiSpec = await asyncParser.parse(input);

  let flogo: any = {};
  flogo.properties = [];
  addAppndetails(flogo, apiSpec);

  let server: asyncParser.Server, serverNamesArr: string[], serverName: string;

  serverNamesArr = serverNames ? serverNames.split(',') : apiSpec.serverNames();
  if (serverNamesArr.length === 0) {
    throw Error('Server information missing in spec');
  }
  serverName = serverNamesArr[0];
  server = getServer(serverName);
  let properties = genAppProperties(server, serverName);
  flogo.properties = [...flogo.properties, ...properties];

  let protocol = server.protocol().toLowerCase();
  if (protocol == 'kafka') {
    for (let i = 1; i < serverNamesArr.length; i++) {
      let server = getServer(serverNamesArr[i]);
      let properties = genAppProperties(server, serverNamesArr[i]);
      flogo.properties = [...flogo.properties, ...properties];
    }
  }

  switch (true) {
    case protocol == 'http' || protocol == 'https':
      flogo = (await import('./protocols/http')).transform(flogo, apiSpec, serverName);
      break;
    case protocol == 'kafka' || protocol == 'kafka-secure':
      flogo = await (await import('./protocols/kafka')).transform(flogo, apiSpec, serverNamesArr);
      break;
    case protocol == 'ws' || protocol == 'wss':
      flogo = await (await import('./protocols/ws')).transform(flogo, apiSpec, serverName);
      break;
    case protocol == 'mqtt':
      flogo = await (await import('./protocols/mqtt')).transform(flogo, apiSpec, serverName);
      break;
  }
  return flogo;
}

function addAppndetails(flogo: any, apiSpec: asyncParser.AsyncAPIDocument) {
  let info = apiSpec.info();
  flogo.name = apiSpec.id() || info.title();
  flogo.type = TYPE;
  flogo.version = info.version();

  if (info.hasDescription()) {
    flogo.description = info.description();
  }
  flogo.appModel = APP_MODEL;
  return flogo;
}

function genAppProperties(server: asyncParser.Server, serverName: string) {
  let properties: any = [];
  if (!server.hasVariables()) return properties;

  let variables = server.variables();

  for (let variable in variables) {
    let property: any = {};
    let variableObj = variables[variable];
    property.name = `${serverName}.${variable}`;

    if (variableObj.hasDefaultValue()) {
      property.type = typeof variableObj.defaultValue();
      property.value = variableObj.defaultValue();
    } else if (variableObj.hasAllowedValues()) {
      property.type = typeof variableObj.allowedValues()[0];
      property.value = variableObj.allowedValues()[0];
    }

    properties.push(property);
  }

  return properties;
}

function getServer(name: string) {
  let server = apiSpec.server(name);
  if (server == null) {
    throw new Error(`Server ${name} could not be found`);
  }
  return server;
}
