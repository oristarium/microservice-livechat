# YouTube Live Chat WebSocket Microservice

A WebSocket-based microservice that provides real-time YouTube live chat messages without requiring the YouTube API.

## Features

- WebSocket endpoints for real-time chat messages
- Support for multiple YouTube channels simultaneously
- Automatic cleanup of inactive streams
- Resource management (stops watching when no clients are connected)
- Error handling and status updates
- Health check endpoint

## Local Development

### Installation

```bash
npm install
```

### Running Locally

```bash
node server.js
```

## Deployment Instructions

### Prerequisites
- Ubuntu 22.04
- Docker
- Docker Compose

### Deployment Steps

1. Clone the repository:
```bash
cd /opt
sudo mkdir youtube-chat
sudo chown $USER:$USER youtube-chat
cd youtube-chat
git clone [REPOSITORY_URL] .
```

2. Build and run with Docker:
```bash
docker-compose up -d --build
```

3. Verify the service is running:
```bash
docker-compose ps
```

### Maintenance Commands

- View logs:
```bash
docker-compose logs -f
```

- Restart service:
```bash
docker-compose restart
```

- Stop service:
```bash
docker-compose down
```

- Update from repository:
```bash
git pull
docker-compose up -d --build
```

## WebSocket Usage

Connect to the WebSocket endpoint:
```javascript
const ws = new WebSocket('ws://localhost:3000');

// Subscribe to a channel
ws.send(JSON.stringify({
    type: 'subscribe',
    identifier: 'YOUTUBE_CHANNEL_ID',
    identifierType: 'channelId'
}));

// Listen for messages
ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    switch (message.type) {
        case 'chat':
            console.log('New chat message:', message.data);
            break;
        case 'status':
            console.log('Status update:', message.status);
            break;
        case 'error':
            console.error('Error:', message.error);
            break;
    }
};
```

## API Reference

### Incoming Messages (Client to Server)

Subscribe to a channel:
```javascript
{
    type: 'subscribe',
    identifier: string,      // Channel ID, handle, or livestream ID
    identifierType: 'channelId' | 'handle' | 'liveId'
}
```

### Outgoing Messages (Server to Client)

Chat message format:
```javascript
{
    "type": "chat",
    "platform": "youtube"|"twitch"|"tiktok",
    "timestamp": "2024-03-20T12:34:56.789Z",
    "message_id": "unique-message-id",
    "room_id": "stream-or-channel-id",
    "data": {
        "author": {
            "id": "user-unique-id",
            "username": "username",
            "display_name": "Display Name",
            "avatar_url": "https://example.com/avatar.jpg",
            "roles": {
                "broadcaster": false,
                "moderator": true,
                "subscriber": true,
                "verified": false
            },
            "badges": [
                {
                    "type": "subscriber"|"moderator"|"verified"|"custom",
                    "label": "Member (1 year)",
                    "image_url": "https://example.com/badge.png"
                }
            ]
        },
        "content": {
            "raw": "Hello 😊 world! :custom-emote:",
            "formatted": "Hello 😊 world! :custom-emote:",
            "sanitized": "Hello world!",
            "elements": [
                {
                    "type": "text",
                    "value": "Hello ",
                    "position": [0, 6]
                },
                {
                    "type": "emote",
                    "value": "😊",
                    "position": [6, 7],
                    "metadata": {
                        "url": "https://example.com/emote.png",
                        "alt": "smiling face",
                        "is_custom": false
                    }
                },
                {
                    "type": "text",
                    "value": " world! ",
                    "position": [7, 14]
                },
                {
                    "type": "emote",
                    "value": "custom-emote",
                    "position": [14, 26],
                    "metadata": {
                        "url": "https://example.com/custom-emote.png",
                        "alt": "custom emote",
                        "is_custom": true
                    }
                }
            ]
        },
        "metadata": {
            "type": "chat"|"super_chat"|"subscription"|"follow",
            "monetary_data": {
                "amount": "10.00",
                "currency": "USD",
                "formatted": "$10.00",
                "color": "#FF0000"
            },
            "sticker": {
                "url": "https://example.com/sticker.png",
                "alt": "sticker description"
            }
        }
    }
}
```

Example chat message response:
```javascript
{
    "type": "chat",
    "platform": "youtube",
    "timestamp": "2024-03-20T12:34:56.789Z",
    "message_id": "abc123xyz",
    "room_id": "UCxxxxxxxxxxxxxxx",
    "data": {
        "author": {
            "id": "UCyyyyyyyyyyyy",
            "username": "user123",
            "display_name": "Cool User",
            "avatar_url": "https://yt3.ggpht.com/avatar123",
            "roles": {
                "broadcaster": false,
                "moderator": false,
                "subscriber": true,
                "verified": false
            },
            "badges": [
                {
                    "type": "subscriber",
                    "label": "Member (2 years)",
                    "image_url": "https://yt3.ggpht.com/badge123"
                }
            ]
        },
        "content": {
            "raw": "Hello everyone! 👋 :heart-emoji: Great stream!",
            "formatted": "Hello everyone! 👋 :heart-emoji: Great stream!",
            "sanitized": "Hello everyone! Great stream!",
            "elements": [
                {
                    "type": "text",
                    "value": "Hello everyone! ",
                    "position": [0, 14]
                },
                {
                    "type": "emote",
                    "value": "👋",
                    "position": [14, 15]
                },
                {
                    "type": "emote",
                    "value": "heart-emoji",
                    "position": [16, 27],
                    "metadata": {
                        "url": "https://yt3.ggpht.com/heart-emoji.png",
                        "alt": "heart emoji",
                        "is_custom": true
                    }
                },
                {
                    "type": "text",
                    "value": " Great stream!",
                    "position": [27, 40]
                }
            ]
        },
        "metadata": {
            "type": "chat"
        }
    }
}
```

Status update format:
```javascript
{
    type: 'status',
    status: 'started' | 'subscribed',
    liveId?: string,
    identifier?: string
}
```

Error message format:
```javascript
{
    type: 'error',
    error: string
}
```

## Health Check

GET `/health` - Returns the status of the service and number of active streams.