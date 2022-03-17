# CLI Plugin AsyncAPI for TIBCO Cloud™

This plugin will help you to generate a sample Flogo® app from AsyncAPI spec(v2.1.0). \
Supported protocols are:

- Apache Kafka
- MQTT
- HTTP
- WebSocket

Every publish operation of a channel will be transformed into a trigger.\
Every subscribe operation of a channel will be transformed into a write activity of a flow.

> **_NOTE:_** Transformation for HTTP is based on some assumptions (see HTTP example specs), it is better to have them written in OpenAPI format.

# Usage

```
Install Plugin
  $ tibco plugin:install @tibco-software/cli-plugin-asyncapi
USAGE
  $ tibco asyncapi:transform [flags] <args>
```
## Commands

  <!-- commands -->
* [`tibco asyncapi:transform`](#tibco-asyncapitransform)

## `tibco asyncapi:transform`

Transform AsyncAPI spec to Flogo

```
USAGE
  $ tibco asyncapi:transform

OPTIONS
  -f, --from=from          (required) Path to the source file
  -s, --server=server      (required) Server name in asyncapi spec. Comma separated servers incase of Kafka Cluster
  -t, --to=flogo|asyncapi  [default: flogo] conversion type
  --no-warnings            Disable warnings from commands outputs

EXAMPLE
  tibco asyncapi:transform --to flogo --from ./asyncapispec.json
```

_See code: [src/commands/asyncapi/transform.ts](https://github.com/TIBCOSoftware/cic-cli-plugin-asyncapi/blob/v1.0.0-beta.1/src/commands/asyncapi/transform.ts)_
<!-- commandsstop -->
