let activeRooms = 0;
let connectedUsers = 0;

export function onRoomCreated() {
  activeRooms += 1;
}

export function onRoomDisposed() {
  activeRooms = Math.max(0, activeRooms - 1);
}

export function onUserConnected() {
  connectedUsers += 1;
}

export function onUserDisconnected() {
  connectedUsers = Math.max(0, connectedUsers - 1);
}

export function getLiveStats() {
  return {
    activeRooms,
    connectedUsers,
  };
}

