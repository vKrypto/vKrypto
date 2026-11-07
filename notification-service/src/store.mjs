// DynamoDB single-table layout
//   pk = USER#<userId>      sk = DEVICE#<deviceId>   -> push subscription + metadata
//   pk = WEBHOOK            sk = WEBHOOK#<id>        -> url, secret, events[]
//   pk = LOG#<yyyy-mm-dd>   sk = <iso ts>#<eventId>  -> delivery summary (expires via ttl)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand, ScanCommand,
} from "@aws-sdk/lib-dynamodb";

const LOG_TTL_DAYS = 30;

export function createStore(tableName, client = DynamoDBDocumentClient.from(new DynamoDBClient({}))) {
  const TableName = tableName;

  async function queryAll(params) {
    const items = [];
    let ExclusiveStartKey;
    do {
      const res = await client.send(new QueryCommand({ TableName, ...params, ExclusiveStartKey }));
      items.push(...(res.Items ?? []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  return {
    putDevice(device) {
      return client.send(new PutCommand({
        TableName,
        Item: { pk: `USER#${device.userId}`, sk: `DEVICE#${device.deviceId}`, type: "device", ...device },
      }));
    },

    deleteDevice(userId, deviceId) {
      return client.send(new DeleteCommand({
        TableName, Key: { pk: `USER#${userId}`, sk: `DEVICE#${deviceId}` },
      }));
    },

    devicesForUser(userId) {
      return queryAll({
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":sk": "DEVICE#" },
      });
    },

    // Broadcast. A scan is fine (and cheapest) at a few hundred devices.
    async allDevices() {
      const items = [];
      let ExclusiveStartKey;
      do {
        const res = await client.send(new ScanCommand({
          TableName,
          FilterExpression: "#t = :t",
          ExpressionAttributeNames: { "#t": "type" },
          ExpressionAttributeValues: { ":t": "device" },
          ExclusiveStartKey,
        }));
        items.push(...(res.Items ?? []));
        ExclusiveStartKey = res.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items;
    },

    putWebhook(hook) {
      return client.send(new PutCommand({
        TableName, Item: { pk: "WEBHOOK", sk: `WEBHOOK#${hook.id}`, type: "webhook", ...hook },
      }));
    },

    deleteWebhook(id) {
      return client.send(new DeleteCommand({ TableName, Key: { pk: "WEBHOOK", sk: `WEBHOOK#${id}` } }));
    },

    listWebhooks() {
      return queryAll({
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": "WEBHOOK" },
      });
    },

    putLog(entry) {
      const now = new Date();
      return client.send(new PutCommand({
        TableName,
        Item: {
          pk: `LOG#${now.toISOString().slice(0, 10)}`,
          sk: `${now.toISOString()}#${entry.eventId}`,
          type: "log",
          ttl: Math.floor(now.getTime() / 1000) + LOG_TTL_DAYS * 86400,
          ...entry,
        },
      }));
    },

    listLogs(day) {
      return queryAll({
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": `LOG#${day}` },
        ScanIndexForward: false,
      });
    },
  };
}
