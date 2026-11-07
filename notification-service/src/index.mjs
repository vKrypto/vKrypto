import { createApp } from "./app.mjs";
import { createStore } from "./store.mjs";
import { createPushSender } from "./delivery.mjs";

// Built once per Lambda container and reused across invocations.
const env = process.env;
const app = createApp({
  store: createStore(env.TABLE_NAME),
  sendPush: createPushSender({
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  }),
  config: { adminApiKey: env.ADMIN_API_KEY, vapidPublicKey: env.VAPID_PUBLIC_KEY },
});

export const handler = (event) => app(event);
