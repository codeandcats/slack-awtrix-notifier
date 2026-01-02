// Script which estimates the count of private and public channels and DMs in Slack
// for a given user that contain unread messages, and prints the count of said channels/DMs
// to the console.

import { WebClient } from "@slack/web-api";
import assertNever from "assert-never";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_AWTRIX_ICON = 29039;

class EnvVarNotSetError extends Error {
  constructor(varName: string) {
    super(`${varName} environment variable is not set`);
    this.name = "EnvVarNotSetError";
  }
}

type AwtrixConfig = {
  host: string;
  user?: string;
  password?: string;
};

type Config = {
  slackToken: string;
  importantChannelNames: string[];
  awtrix: AwtrixConfig;
};

function getConfig(): Config {
  const awtrixHost = process.env.AWTRIX_HOST;
  const awtrixUser = process.env.AWTRIX_USER;
  const awtrixPassword = process.env.AWTRIX_PASSWORD;
  const importantChannelNames = (process.env.IMPORTANT_CHANNEL_NAMES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const slackToken = process.env.SLACK_TOKEN;
  const icon = process.env.AWTRIX_ICON;

  if (!slackToken) throw new EnvVarNotSetError("SLACK_TOKEN");
  if (!awtrixHost) throw new EnvVarNotSetError("AWTRIX_HOST");

  const awtrix = {
    host: awtrixHost,
    user: awtrixUser,
    password: awtrixPassword,
    icon: icon ? parseInt(icon, 10) : DEFAULT_AWTRIX_ICON,
  };

  return {
    awtrix,
    importantChannelNames,
    slackToken,
  };
}

type Channel = Exclude<
  Awaited<ReturnType<WebClient["users"]["conversations"]>>["channels"],
  undefined
>[number];

type DirectMessageChannel = Channel & { is_im: true };

type NonDirectMessageChannel = Channel & { is_im?: false };

function isDirectMessageChannel(
  channel: Channel
): channel is DirectMessageChannel {
  return channel.is_im === true;
}

function isNonDirectMessageChannel(
  channel: Channel
): channel is NonDirectMessageChannel {
  return channel.is_im !== true;
}

async function getHasUnreadDirectMessages({
  client,
  channels,
}: {
  client: WebClient;
  channels: DirectMessageChannel[];
}) {
  return await Promise.any(
    channels.map(async (channel) => {
      if (!channel.id) return false;

      const { channel: info } = await client.conversations.info({
        channel: channel.id,
        include_num_members: false,
      });

      return (
        info &&
        "unread_count_display" in info &&
        typeof info.unread_count_display === "number" &&
        info.unread_count_display > 0
      );
    })
  );
}

async function sendAwtrixRequest({
  awtrixConfig,
  body,
  method,
  path,
}: {
  awtrixConfig: AwtrixConfig;
  path: string;
  method: "GET" | "POST";
  body?: any;
}) {
  const url = `http://${awtrixConfig.host}${path}`;

  const auth =
    awtrixConfig.user && awtrixConfig.password
      ? "Basic " +
        Buffer.from(`${awtrixConfig.user}:${awtrixConfig.password}`).toString(
          "base64"
        )
      : undefined;

  const response = await fetch(url, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `Awtrix request failed: ${response.status} - ${responseBody}`
    );
  }
}

type AwtrixNotificationOptions = {
  awtrixConfig: AwtrixConfig;
  color?: string;
  icon?: number;
  text: string;
};

async function notify({
  awtrixConfig,
  color,
  icon,
  text,
}: AwtrixNotificationOptions) {
  console.info(`Sending notification: ${text}`);

  await sendAwtrixRequest({
    awtrixConfig,
    method: "POST",
    path: "/api/notify",
    body: {
      text,
      color,
      icon,
    },
  });

  console.info("Notification sent");
}

async function dismissNotification({
  awtrixConfig,
}: {
  awtrixConfig: AwtrixConfig;
}) {
  console.info(`Dismissing notification`);

  await sendAwtrixRequest({
    awtrixConfig,
    method: "POST",
    path: "/api/notify/dismiss",
  });

  console.info("Notification dismissed");
}

type UnreadStatus =
  | "unreadMentions"
  | "unreadDirectMessages"
  | "unreadImportantChannelMessages"
  | "unreadChannelMessages"
  | "noUnreadMessages";

async function getUnreadStatus({
  client,
  channels,
  importantChannelNames,
}: {
  client: WebClient;
  channels: Channel[];
  importantChannelNames: string[];
}): Promise<UnreadStatus> {
  if (
    await getHasUnreadDirectMessages({
      client,
      channels: channels.filter(isDirectMessageChannel),
    })
  ) {
    return "unreadDirectMessages";
  }

  // TODO: Check for unread mentions

  const nonDirectMessageChannels = channels.filter(isNonDirectMessageChannel);

  let hasUnreadImportantChannelMessages = false;
  let hasUnreadChannelMessages = false;

  await Promise.all(
    nonDirectMessageChannels.map(async (channel) => {
      if (!channel.id) return;

      const { channel: info } = await client.conversations.info({
        channel: channel.id,
        include_num_members: false,
      });

      if (!info || !info.last_read) return;

      const history = await client.conversations.history({
        channel: channel.id,
        oldest: info.last_read,
        limit: 1,
      });

      if (!!history.messages?.length) {
        if (importantChannelNames.includes(channel.name ?? "")) {
          hasUnreadImportantChannelMessages = true;
        } else {
          hasUnreadChannelMessages = true;
        }
      }
    })
  );

  if (hasUnreadImportantChannelMessages) {
    return "unreadImportantChannelMessages";
  }

  if (hasUnreadChannelMessages) {
    return "unreadChannelMessages";
  }

  return "noUnreadMessages";
}

const SNOOZE_FILE_PATH = path.resolve(__dirname, "snooze.json");

async function snoozeNotifications(
  durationMinutes: string | number | undefined = 5
) {
  const snoozeUntil = new Date(
    Date.now() + Number(durationMinutes) * 60 * 1000
  );
  await writeFile(
    SNOOZE_FILE_PATH,
    JSON.stringify({ snoozeUntil: snoozeUntil.toISOString() }),
    "utf8"
  );

  console.info(`Snoozed notifications for ${durationMinutes} minutes`);
}

async function getIsSnoozed() {
  if (!(await stat(SNOOZE_FILE_PATH).catch(() => false))) {
    return false;
  }

  const data = await readFile(SNOOZE_FILE_PATH, "utf8");
  const { snoozeUntil } = JSON.parse(data) as { snoozeUntil: string };

  return new Date(snoozeUntil).getTime() > Date.now();
}

async function checkAndNotify({
  config: { awtrix: awtrixConfig, importantChannelNames, slackToken },
}: {
  config: Config;
}) {
  const client = new WebClient(slackToken);

  const response = await client.users.conversations({
    types: "public_channel,private_channel,im,mpim",
  });

  const channels = (response.channels ?? []).filter(
    (channel) => !channel.is_archived
  );

  const status = await getUnreadStatus({
    client,
    channels,
    importantChannelNames: importantChannelNames,
  });

  switch (status) {
    case "unreadMentions":
      await notify({
        awtrixConfig,
        color: "#FF0000",
        text: "Unread Mentions",
      });
      return;
    case "unreadDirectMessages":
      await notify({
        awtrixConfig,
        color: "#FF6600",
        text: "Unread DM",
      });
      return;
    case "unreadImportantChannelMessages":
      await notify({
        awtrixConfig,
        color: "#FFAA00",
        text: "Unread Important Messages",
      });
      return;
    case "unreadChannelMessages":
      await notify({
        awtrixConfig,
        color: "#AAAAFF",
        text: "Unread Messages",
      });
      return;
    case "noUnreadMessages":
      return;
    default:
      assertNever(status);
  }
}

function getCommandFromArgs(args: string[]) {
  if (args[0] === "--snooze") {
    const durationMinutes = parseInt(args[1] || "5", 10);
    if (isNaN(durationMinutes) || durationMinutes <= 0) {
      throw new Error(
        "Invalid snooze duration, must be a positive number of minutes"
      );
    }

    return {
      type: "snooze",
      durationMinutes,
    } as const;
  }

  if (args[0] === "--dismiss") {
    return { type: "dismiss" } as const;
  }

  return { type: "notify" } as const;
}

async function run() {
  const command = getCommandFromArgs(process.argv.slice(2));

  const config = getConfig();
  const awtrixConfig = config.awtrix;

  switch (command.type) {
    case "snooze":
      await snoozeNotifications(command.durationMinutes);
      return;

    case "dismiss":
      await dismissNotification({ awtrixConfig });
      return;

    case "notify":
      if (await getIsSnoozed()) {
        console.info("Notifications are snoozed, exiting");
        return;
      }
      await checkAndNotify({ config: config });
      return;

    default:
      return assertNever(command);
  }
}

run().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
