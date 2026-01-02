# Slack Awtrix Notifier

Monitors slack and sends a notification to an awtrix display when there are new unread messages requiring your attention.

## Prerequisites

You will need to create a Slack API app with the following **_User_** Token Scopes:

| OAuth Scope      | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| channels:history | View messages and other content in a user's public channels       |
| channels:read    | View basic information about public channels in a workspace       |
| groups:history   | View messages and other content in a user's private channels      |
| groups:read      | View basic information about a user's private channels            |
| im:history       | View messages and other content in a user's direct messages       |
| im:read          | View basic information about a user's direct messages             |
| mpim:history     | View messages and other content in a user's group direct messages |
| mpim:read        | View basic information about a user's group direct messages       |
| users:read       | View people in a workspace                                        |

## Set up

Install dependencies

```sh
npm i
```

Set up config `.env.config`

```sh
# Comma separated list of important channel names (optional)
IMPORTANT_CHANNELS=

# Awtrix IP Address
AWTRIX_HOST=

# Awtrix icon to use (optional). See https://blueforcer.github.io/awtrix3/#/icons
AWTRIX_ICON=
```

Set up your secrets in `.env` file:

```sh
# User OAuth Token from Slack API app
SLACK_TOKEN=

# Awtrix username and password (optional)
AWTRIX_USER=
AWTRIX_PASSWORD=
```

## Usage

...
