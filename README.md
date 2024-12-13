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
    type: 'chat',
    data: {
        author: {
            name: string,
            channelId: string,
            thumbnail: {
                url: string,
                alt: string
            },
            badge?: {
                thumbnail: {
                    url: string,
                    alt: string
                },
                label: string
            }
        },
        message: Array<{
            text?: string,
            emojiText?: string,
            url?: string,
            alt?: string,
            isCustomEmoji?: boolean
        }>,
        superchat?: {
            amount: string,
            color: string,
            sticker?: {
                url: string,
                alt: string
            }
        },
        isMembership: boolean,
        isVerified: boolean,
        isOwner: boolean,
        isModerator: boolean,
        timestamp: Date
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

## Notes

- The service automatically cleans up resources when clients disconnect
- No YouTube API key required
- Supports multiple simultaneous connections to different channels
- For production deployment, consider setting up Nginx as a reverse proxy with SSL
- Make sure to configure your firewall to allow traffic on port 3000

## Microservice Project

## Deployment Instructions

### Prerequisites
- Ubuntu 22.04
- Docker
- Docker Compose

### Deployment Steps

1. Clone the repository: 