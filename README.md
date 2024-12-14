# Live Chat WebSocket Microservice

A WebSocket-based microservice that provides real-time live chat messages and statistics from multiple platforms (YouTube, TikTok, and Twitch) without requiring their APIs.

## Features

- WebSocket endpoints for real-time chat messages
- Real-time chat statistics tracking
- Support for multiple platforms (YouTube, TikTok, Twitch)
- Support for multiple channels simultaneously
- Support for multiple clients per channel
- Automatic cleanup of inactive streams
- Resource management (stops watching when no clients are connected)
- Error handling and status updates
- Health check endpoint
- Redis support for persistent statistics (optional)

## Local Development

### Installation

```bash
npm install
```

### Running Locally

```bash
# Without Redis (uses in-memory storage)
node server.js

# With Redis
REDIS_URL=redis://localhost:6379 STATS_STORAGE=redis node server.js
```

### Docker Compose

```yaml
services:
  microservice-livechat:
    environment:
      - REDIS_URL=redis://redis:6379
      - STATS_STORAGE=redis
    # ... other config

  redis:
    image: redis:7-alpine
    command: redis-server --save 60 1 --loglevel warning
    volumes:
      - redis-data:/data
```

## WebSocket Protocol

Each WebSocket connection can:
- Subscribe to multiple live chats simultaneously (in separate browser tabs/windows)
- Share live chat subscriptions with other clients
- Maintain independent subscription states
- Receive real-time updates for all subscribed chats

The server will:
- Maintain separate chat handlers for each unique channel
- Share chat handlers between clients watching the same channel
- Clean up chat handlers only when no clients are watching
- Track statistics per channel (either in memory or Redis)

Note: While technically possible to subscribe to multiple chats in one connection, the current test interface (`/test`) is designed to handle one subscription per tab for better user experience and resource management.

### Client Messages

1. Subscribe to a chat:
```javascript
{
    "type": "subscribe",
    "identifier": string,      // Channel username (without @), ID, or livestream ID
    "identifierType": "username" | "channelId" | "liveId", // YouTube only, defaults to "username"
    "platform": "youtube" | "tiktok" | "twitch"      // defaults to "youtube"
}
```

Note: The term "subscribe" here refers to establishing a WebSocket connection to receive chat messages, not subscribing to the channel on the respective platform.

Platform-specific identifier requirements:
- YouTube: Supports username (without @), channel ID (UC...), or live ID (watch?v=...)
- TikTok: Only supports username (without @)
- Twitch: Only supports username (without @)

2. Unsubscribe from current chat:
```javascript
{
    "type": "unsubscribe"
}
```

3. Request current stats:
```javascript
{
    "type": "get_stats"
}
```

### Server Messages

1. Status Updates:
```javascript
{
    "type": "status",
    "status": "started" | "subscribed" | "unsubscribed",
    "liveId": string,     // Only present for "started" status
    "identifier": string  // Only present for "subscribed" status
}
```

2. Error Messages:
```javascript
{
    "type": "error",
    "error": string,
    "code": string,      // Error code for specific errors
    "details": string    // Optional additional error details
}
```

Common error codes:
- `STREAM_NOT_LIVE`: The stream is not currently live
- `STREAM_ENDED`: The stream has ended
- `INVALID_MESSAGE_TYPE`: Unknown message type received
- `NO_ACTIVE_CHAT`: No chat is currently subscribed
- `STREAM_NOT_FOUND`: Stream data not found
- `UNSUPPORTED_PLATFORM`: Platform not supported

3. Chat Messages:
```javascript
{
    "type": "chat",
    "data": {
        "type": "chat",
        "platform": "youtube" | "tiktok" | "twitch",
        "timestamp": "2024-03-20T12:34:56.789Z",
        "message_id": string,
        "room_id": string,
        "data": {
            "author": {
                "id": string,
                "username": string,
                "display_name": string,
                "avatar_url": string,
                "roles": {
                    "broadcaster": boolean,
                    "moderator": boolean,
                    "subscriber": boolean,
                    "verified": boolean
                },
                "badges": [
                    {
                        "type": "subscriber" | "moderator" | "verified" | "custom",
                        "label": string,
                        "image_url": string
                    }
                ]
            },
            "content": {
                "raw": string,        // Original message with emotes
                "formatted": string,  // Message with emote codes
                "sanitized": string,  // Plain text only
                "rawHtml": string,    // Pre-rendered HTML with emotes
                "elements": [         // Message broken into parts
                    {
                        "type": "text" | "emote",
                        "value": string,
                        "position": [number, number],
                        "metadata"?: {  // Only for emotes
                            "url": string,
                            "alt": string,
                            "is_custom": boolean
                        }
                    }
                ]
            },
            "metadata": {
                "type": "chat" | "super_chat",
                "monetary_data"?: {    // Only for super_chat
                    "amount": string,
                    "formatted": string,
                    "color": string
                },
                "sticker"?: {         // Only for sticker super_chats
                    "url": string,
                    "alt": string
                }
            }
        }
    }
}
```

4. Stats Updates:
```javascript
{
    "type": "stats",
    "data": {
        "uniqueUsers": [
            {
                "id": string,
                "username": string,
                "display_name": string,
                "roles": {
                    "broadcaster": boolean,
                    "moderator": boolean,
                    "subscriber": boolean,
                    "verified": boolean
                },
                "messageCount": number
            }
        ],
        "totalMessages": number
    }
}
```

## Example Usage

```javascript
const ws = new WebSocket('ws://localhost:3000');

// Connect to YouTube chat using username (default)
ws.send(JSON.stringify({
    type: 'subscribe',
    identifier: 'ceresfauna',
    identifierType: 'username', // this is the default
    platform: 'youtube' // this is the default
}));

// Connect to TikTok chat using username
ws.send(JSON.stringify({
    type: 'subscribe',
    identifier: 'tiktokuser',
    platform: 'tiktok'
}));

// Connect to Twitch chat using username
ws.send(JSON.stringify({
    type: 'subscribe',
    identifier: 'twitchuser',
    platform: 'twitch'
}));

// Handle incoming messages
ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    switch (message.type) {
        case 'chat':
            console.log('New chat message:', message.data);
            break;
        case 'stats':
            console.log('Stats update:', message.data);
            break;
        case 'status':
            console.log('Status update:', message.status);
            break;
        case 'error':
            console.error('Error:', message.error, message.code);
            break;
    }
};
```

## Test Interface

The service provides a test interface at `/test` that allows you to:
- Select platform (YouTube, TikTok, or Twitch)
- Connect to different channels
- View live chat messages with badges and emotes
- Monitor chat statistics in real-time
- View top chatters and message counts

## Health Check

GET `/health` - Returns the status of the service and number of active streams:
```javascript
{
    "status": "ok",
    "activeStreams": number
}
```