"use client";

import { useEffect, useCallback, useRef } from "react";
import { usePeerStore } from "@/store/usePeerStore";
import { useGroupStore, type GroupChatMessage } from "@/store/useGroupStore";
import type Peer from "peerjs";
import type { DataConnection, MediaConnection } from "peerjs";

// ─── ICE config (mirrors PeerContainer — same TURN servers) ──────────────────
const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

const TURN_HOST_RAW = process.env.NEXT_PUBLIC_TURN_HOST ?? "";
const TURN_USER = process.env.NEXT_PUBLIC_TURN_USER ?? "";
const TURN_PASS = process.env.NEXT_PUBLIC_TURN_PASS ?? "";

function stripSchemeAndPort(host: string): string {
  return host
    .replace(/^(turns?:)(\/\/)?/, "")
    .replace(/:\d+.*$/, "")
    .trim();
}
const TURN_HOST = stripSchemeAndPort(TURN_HOST_RAW);
const hasPrivateTurn = !!(TURN_HOST && TURN_USER && TURN_PASS);

const ICE_SERVERS: RTCIceServer[] = [
  ...STUN_SERVERS,
  ...(hasPrivateTurn
    ? [
        {
          urls: [
            "turn:global.relay.metered.ca:80",
            "turn:global.relay.metered.ca:80?transport=tcp",
            "turns:global.relay.metered.ca:443?transport=tcp",
          ],
          username: TURN_USER,
          credential: TURN_PASS,
        },
      ]
    : []),
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:80?transport=tcp",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

// ─── Data message protocol ────────────────────────────────────────────────────
type GroupDataMessage =
  | { type: "chat"; text: string; displayName: string }
  | { type: "room-peers"; peers: string[]; roomId: string }
  | { type: "join-room"; peerId: string; roomId: string; displayName: string }
  | { type: "new-peer"; peerId: string; displayName: string }
  | { type: "leave-room"; peerId: string }
  | { type: "mute-state"; isMuted: boolean };

// ─── Best-effort media stream ─────────────────────────────────────────────────
async function getBestStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: true,
    });
  } catch (err) {
    const name = (err as Error).name;
    if (name === "NotAllowedError" || name === "PermissionDeniedError")
      throw err;
    console.warn(
      "[GroupPeer] Combined video+audio failed, trying fallbacks:",
      err,
    );
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true });
    } catch {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        console.log("[GroupPeer] ✅ Audio-only fallback successful.");
        return s;
      } catch {
        throw err;
      }
    }
  }
}

// ─── GroupPeerContainer ───────────────────────────────────────────────────────
// Delegates incoming call/connection routing from PeerContainer.
// PeerContainer's handlers call routeIncomingCallToGroup / routeIncomingDataToGroup
// when groupStatus === "in-room", so there is exactly ONE handler per event.
export default function GroupPeerContainer({
  children,
}: {
  children: React.ReactNode;
}) {
  const installedRef = useRef(false);

  useEffect(() => {
    // Poll until the Peer from PeerContainer is ready
    const interval = setInterval(() => {
      const peer = usePeerStore.getState().peer;
      if (!peer || installedRef.current) return;
      installedRef.current = true;
      clearInterval(interval);
      console.log("[GroupPeer] Peer instance available — group routing ready.");

      // Periodic reconnect health check
      const healthCheck = setInterval(() => {
        const gs = useGroupStore.getState();
        if (gs.groupStatus !== "in-room") return;
        gs.participants.forEach((p, peerId) => {
          const connState = p.mediaCall?.peerConnection?.connectionState;
          if (connState === "failed" || connState === "disconnected") {
            console.warn(
              `[GroupPeer] Connection to ${peerId} is ${connState}, reconnecting…`,
            );
            useGroupStore.getState().updateParticipant(peerId, {
              mediaCall: null,
              remoteStream: null,
              hasVideo: false,
              hasAudio: false,
            });
            const localStream = gs.localStream;
            if (localStream) connectToPeer(peer, peerId, localStream);
          }
        });
      }, 8000);

      return () => clearInterval(healthCheck);
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return <>{children}</>;
}

// ─── Called by PeerContainer when an incoming call arrives ───────────────────
// Returns true if the group handled it (caller should NOT handle it).
export function routeIncomingCallToGroup(call: MediaConnection): boolean {
  const gs = useGroupStore.getState();
  if (gs.groupStatus !== "in-room") return false;

  const remotePeerId = call.peer;
  console.log(
    `[GroupPeer] Routing incoming call from ${remotePeerId} to group`,
  );

  const localStream = gs.localStream;
  if (!localStream) {
    console.warn(
      "[GroupPeer] No local stream yet — answering with empty stream",
    );
  }
  call.answer(localStream ?? new MediaStream());

  if (!gs.participants.has(remotePeerId)) {
    useGroupStore.getState().addParticipant({
      peerId: remotePeerId,
      displayName: remotePeerId.slice(0, 8),
      remoteStream: null,
      mediaCall: call,
      dataConnection: null,
      hasVideo: false,
      hasAudio: false,
      isMuted: false,
      joinedAt: new Date(),
    });
  } else {
    useGroupStore
      .getState()
      .updateParticipant(remotePeerId, { mediaCall: call });
  }

  setupMediaCallHandlers(call, remotePeerId);
  return true;
}

// ─── Called by PeerContainer when an incoming data connection arrives ─────────
// Returns true if the group handled it.
export function routeIncomingDataToGroup(conn: DataConnection): boolean {
  const gs = useGroupStore.getState();
  if (gs.groupStatus !== "in-room") return false;

  console.log(
    `[GroupPeer] Routing incoming data connection from ${conn.peer} to group`,
  );

  // Deduplicate — if we already have an open data connection, drop the new one
  const existing = gs.participants.get(conn.peer);
  if (existing?.dataConnection?.open) {
    console.log(
      `[GroupPeer] Already have open data connection with ${conn.peer}, ignoring duplicate`,
    );
    conn.close();
    return true;
  }

  if (!gs.participants.has(conn.peer)) {
    useGroupStore.getState().addParticipant({
      peerId: conn.peer,
      displayName: conn.peer.slice(0, 8),
      remoteStream: null,
      mediaCall: null,
      dataConnection: null,
      hasVideo: false,
      hasAudio: false,
      isMuted: false,
      joinedAt: new Date(),
    });
  }

  setupGroupDataConnection(conn);
  return true;
}

// ─── Media call event handlers ────────────────────────────────────────────────
function setupMediaCallHandlers(call: MediaConnection, remotePeerId: string) {
  call.on("stream", (remoteStream: MediaStream) => {
    console.log(
      `[GroupPeer] ✅ Remote stream from ${remotePeerId} — ` +
        `video: ${remoteStream.getVideoTracks().length}, audio: ${remoteStream.getAudioTracks().length}`,
    );
    useGroupStore.getState().updateParticipant(remotePeerId, {
      remoteStream,
      mediaCall: call,
      hasVideo: remoteStream.getVideoTracks().length > 0,
      hasAudio: remoteStream.getAudioTracks().length > 0,
    });
  });

  call.on("close", () => {
    console.log(`[GroupPeer] Call closed with ${remotePeerId}`);
    useGroupStore.getState().updateParticipant(remotePeerId, {
      mediaCall: null,
      remoteStream: null,
      hasVideo: false,
      hasAudio: false,
    });
  });

  call.on("error", (err) => {
    console.warn(`[GroupPeer] Call error with ${remotePeerId}:`, err);
    useGroupStore.getState().updateParticipant(remotePeerId, {
      mediaCall: null,
      remoteStream: null,
      hasVideo: false,
      hasAudio: false,
    });
  });
}

// ─── Data connection setup ────────────────────────────────────────────────────
// NOTE: Do NOT use serialization:"json" — PeerJS with json serialization
// auto-deserializes data, so conn.on("data") receives an object, not a string.
// We use the default binary serialization and manually JSON.stringify/parse.
function setupGroupDataConnection(conn: DataConnection) {
  const handleOpen = () => {
    console.log(`[GroupPeer] ✅ Data connection open with ${conn.peer}`);
    const existing = useGroupStore.getState().participants.get(conn.peer);
    if (!existing) {
      useGroupStore.getState().addParticipant({
        peerId: conn.peer,
        displayName: conn.peer.slice(0, 8),
        remoteStream: null,
        mediaCall: null,
        dataConnection: conn,
        hasVideo: false,
        hasAudio: false,
        isMuted: false,
        joinedAt: new Date(),
      });
    } else {
      useGroupStore
        .getState()
        .updateParticipant(conn.peer, { dataConnection: conn });
    }
  };

  conn.on("data", (raw: unknown) => {
    try {
      // raw is a string when using default serialization
      const msg = (
        typeof raw === "string" ? JSON.parse(raw) : raw
      ) as GroupDataMessage;
      handleGroupMessage(msg, conn.peer);
    } catch {
      console.warn("[GroupPeer] Malformed data message from", conn.peer, raw);
    }
  });

  conn.on("close", () => {
    console.log(`[GroupPeer] Data connection closed with ${conn.peer}`);
    useGroupStore
      .getState()
      .updateParticipant(conn.peer, { dataConnection: null });
  });

  conn.on("error", (err) => {
    console.warn(`[GroupPeer] Data connection error with ${conn.peer}:`, err);
    useGroupStore
      .getState()
      .updateParticipant(conn.peer, { dataConnection: null });
  });

  if (conn.open) {
    handleOpen();
  } else {
    conn.on("open", handleOpen);
  }
}

// ─── Route a parsed group data message ───────────────────────────────────────
function handleGroupMessage(msg: GroupDataMessage, fromPeerId: string) {
  switch (msg.type) {
    case "chat":
      useGroupStore.getState().addGroupMessage({
        id: crypto.randomUUID(),
        from: fromPeerId,
        displayName: msg.displayName || fromPeerId.slice(0, 8),
        text: msg.text,
        timestamp: new Date(),
      });
      break;

    case "room-peers":
      console.log(`[GroupPeer] room-peers from ${fromPeerId}:`, msg.peers);
      handlePeerDiscovery(msg.peers);
      break;

    case "join-room":
      console.log(
        `[GroupPeer] join-room from ${msg.peerId} (${msg.displayName})`,
      );
      handleNewPeerJoining(msg.peerId, msg.displayName);
      break;

    case "new-peer":
      console.log(`[GroupPeer] new-peer: ${msg.peerId} (${msg.displayName})`);
      handlePeerDiscovery([msg.peerId]);
      break;

    case "leave-room":
      console.log(`[GroupPeer] ${msg.peerId} left the room`);
      useGroupStore.getState().removeParticipant(msg.peerId);
      break;

    case "mute-state":
      useGroupStore
        .getState()
        .updateParticipant(fromPeerId, { isMuted: msg.isMuted });
      break;
  }
}

// ─── Connect to newly discovered peers ───────────────────────────────────────
function handlePeerDiscovery(peerIds: string[]) {
  const myId = usePeerStore.getState().myId;
  const peer = usePeerStore.getState().peer;
  if (!peer) return;

  const localStream = useGroupStore.getState().localStream;

  for (const remotePeerId of peerIds) {
    if (remotePeerId === myId) continue;

    const existing = useGroupStore.getState().participants.get(remotePeerId);

    // Already fully connected — skip
    if (existing?.mediaCall && existing?.dataConnection?.open) {
      console.log(`[GroupPeer] Already connected to ${remotePeerId}, skipping`);
      continue;
    }

    // Have media but no data channel yet
    if (existing?.mediaCall && !existing.dataConnection?.open) {
      console.log(`[GroupPeer] Opening data channel only to ${remotePeerId}`);
      const conn = peer.connect(remotePeerId, { reliable: true });
      setupGroupDataConnection(conn);
      continue;
    }

    console.log(`[GroupPeer] Connecting to discovered peer ${remotePeerId}`);
    connectToPeer(peer, remotePeerId, localStream);
  }
}

// ─── Creator: handle a new peer announcing they joined ───────────────────────
function handleNewPeerJoining(peerId: string, displayName: string) {
  const myId = usePeerStore.getState().myId;
  const peer = usePeerStore.getState().peer;
  if (!peer || peerId === myId) return;

  const gs = useGroupStore.getState();

  if (!gs.participants.has(peerId)) {
    useGroupStore.getState().addParticipant({
      peerId,
      displayName,
      remoteStream: null,
      mediaCall: null,
      dataConnection: null,
      hasVideo: false,
      hasAudio: false,
      isMuted: false,
      joinedAt: new Date(),
    });
  } else {
    useGroupStore.getState().updateParticipant(peerId, { displayName });
  }

  // Build list of everyone currently in the room (including creator = myId)
  const existingPeerIds: string[] = [myId];
  gs.participants.forEach((_, pid) => {
    if (pid !== peerId) existingPeerIds.push(pid);
  });

  console.log(`[GroupPeer] Sending room-peers to ${peerId}:`, existingPeerIds);

  // Send room-peers to the new joiner — poll until their data connection is open
  const sendRoomPeers = () => {
    const p = useGroupStore.getState().participants.get(peerId);
    if (p?.dataConnection?.open) {
      const msg: GroupDataMessage = {
        type: "room-peers",
        peers: existingPeerIds,
        roomId: myId,
      };
      try {
        p.dataConnection.send(JSON.stringify(msg));
        console.log(`[GroupPeer] ✅ Sent room-peers to ${peerId}`);
      } catch (e) {
        console.warn(`[GroupPeer] Failed to send room-peers to ${peerId}:`, e);
      }
      return true;
    }
    return false;
  };

  if (!sendRoomPeers()) {
    const t = setInterval(() => {
      if (sendRoomPeers()) clearInterval(t);
    }, 300);
    setTimeout(() => clearInterval(t), 15000);
  }

  // Broadcast new-peer to all existing participants so they connect to the joiner
  const newPeerMsg = JSON.stringify({
    type: "new-peer",
    peerId,
    displayName,
  } as GroupDataMessage);
  gs.participants.forEach((p, pid) => {
    if (pid === peerId) return;
    const notify = () => {
      const current = useGroupStore.getState().participants.get(pid);
      if (current?.dataConnection?.open) {
        try {
          current.dataConnection.send(newPeerMsg);
        } catch {
          /* ignore */
        }
        return true;
      }
      return false;
    };
    if (!notify()) {
      const t = setInterval(() => {
        if (notify()) clearInterval(t);
      }, 300);
      setTimeout(() => clearInterval(t), 15000);
    }
  });
}

// ─── Establish media + data connection to a remote peer ──────────────────────
function connectToPeer(
  peer: Peer,
  remotePeerId: string,
  localStream: MediaStream | null,
) {
  if (!localStream || localStream.getTracks().length === 0) {
    console.warn(
      `[GroupPeer] ⚠️ connectToPeer(${remotePeerId}) — no local stream yet, will retry when stream is ready`,
    );
    // Retry once the stream is available (poll for up to 10s)
    const t = setInterval(() => {
      const stream = useGroupStore.getState().localStream;
      if (stream && stream.getTracks().length > 0) {
        clearInterval(t);
        console.log(
          `[GroupPeer] Stream now available, connecting to ${remotePeerId}`,
        );
        connectToPeer(peer, remotePeerId, stream);
      }
    }, 500);
    setTimeout(() => clearInterval(t), 10000);
    return;
  }

  console.log(
    `[GroupPeer] connectToPeer → ${remotePeerId} ` +
      `(video: ${localStream.getVideoTracks().length}, audio: ${localStream.getAudioTracks().length})`,
  );

  if (!useGroupStore.getState().participants.has(remotePeerId)) {
    useGroupStore.getState().addParticipant({
      peerId: remotePeerId,
      displayName: remotePeerId.slice(0, 8),
      remoteStream: null,
      mediaCall: null,
      dataConnection: null,
      hasVideo: false,
      hasAudio: false,
      isMuted: false,
      joinedAt: new Date(),
    });
  }

  // Media call
  const call = peer.call(remotePeerId, localStream);
  useGroupStore.getState().updateParticipant(remotePeerId, { mediaCall: call });
  setupMediaCallHandlers(call, remotePeerId);

  // Data channel — use default serialization (not "json") to avoid double-parse
  const conn = peer.connect(remotePeerId, { reliable: true });
  setupGroupDataConnection(conn);
}

// ─── useGroupCallActions ──────────────────────────────────────────────────────
export function useGroupCallActions() {
  const groupStore = useGroupStore();

  // Create a new room (you are the host; others join by your peer ID)
  const createRoom = useCallback(
    async (displayName?: string) => {
      const peer = usePeerStore.getState().peer;
      const myId = usePeerStore.getState().myId;
      if (!peer || !myId) return;

      groupStore.setGroupStatus("joining");
      if (displayName) groupStore.setMyDisplayName(displayName);

      let stream: MediaStream;
      try {
        stream = await getBestStream();
        groupStore.setLocalStream(stream);
        groupStore.setHasLocalVideo(stream.getVideoTracks().length > 0);
      } catch (err) {
        console.error("[GroupPeer] Media access failed:", err);
        groupStore.setGroupError("Failed to access camera/microphone.");
        return;
      }

      groupStore.setRoomId(myId);
      groupStore.setGroupStatus("in-room");
      console.log(`[GroupPeer] ✅ Room created: ${myId}`);
    },
    [groupStore],
  );

  // Join an existing room by the host's peer ID
  const joinRoom = useCallback(
    async (roomPeerId: string, displayName?: string) => {
      const peer = usePeerStore.getState().peer;
      const myId = usePeerStore.getState().myId;
      if (!peer || !myId || !roomPeerId) return;

      if (roomPeerId === myId) {
        createRoom(displayName);
        return;
      }

      groupStore.setGroupStatus("joining");
      if (displayName) groupStore.setMyDisplayName(displayName);
      groupStore.setRoomId(roomPeerId);

      let stream: MediaStream;
      try {
        stream = await getBestStream();
        groupStore.setLocalStream(stream);
        groupStore.setHasLocalVideo(stream.getVideoTracks().length > 0);
      } catch (err) {
        console.error("[GroupPeer] Media access failed:", err);
        groupStore.setGroupError("Failed to access camera/microphone.");
        return;
      }

      // Set in-room BEFORE connecting so the incoming call handler on the host
      // side sees groupStatus === "in-room" and routes correctly
      groupStore.setGroupStatus("in-room");

      // Connect to the host — pass stream directly (store update is sync but
      // reading back groupStore.localStream in the same tick is safe here)
      connectToPeer(peer, roomPeerId, stream);

      // Once the data channel to the host opens, send join-room announcement
      const myDisplayName = useGroupStore.getState().myDisplayName;
      const announce = () => {
        const p = useGroupStore.getState().participants.get(roomPeerId);
        if (p?.dataConnection?.open) {
          const msg: GroupDataMessage = {
            type: "join-room",
            peerId: myId,
            roomId: roomPeerId,
            displayName: myDisplayName,
          };
          p.dataConnection.send(JSON.stringify(msg));
          console.log(`[GroupPeer] ✅ Sent join-room to host ${roomPeerId}`);
          return true;
        }
        return false;
      };

      if (!announce()) {
        const t = setInterval(() => {
          if (announce()) clearInterval(t);
        }, 300);
        setTimeout(() => clearInterval(t), 15000);
      }

      console.log(`[GroupPeer] Joining room ${roomPeerId}…`);
    },
    [groupStore, createRoom],
  );

  // Directly invite a peer into the current room
  const invitePeer = useCallback((remotePeerId: string) => {
    const peer = usePeerStore.getState().peer;
    const gs = useGroupStore.getState();
    if (!peer || gs.groupStatus !== "in-room") return;
    if (gs.participants.has(remotePeerId)) return;

    connectToPeer(peer, remotePeerId, gs.localStream);

    // Send them the full peer list once connected
    const sendList = () => {
      const p = useGroupStore.getState().participants.get(remotePeerId);
      if (p?.dataConnection?.open) {
        const peers = [
          usePeerStore.getState().myId,
          ...Array.from(useGroupStore.getState().participants.keys()),
        ];
        const msg: GroupDataMessage = {
          type: "room-peers",
          peers,
          roomId: useGroupStore.getState().roomId,
        };
        try {
          p.dataConnection.send(JSON.stringify(msg));
        } catch {
          /* ignore */
        }
        return true;
      }
      return false;
    };
    if (!sendList()) {
      const t = setInterval(() => {
        if (sendList()) clearInterval(t);
      }, 300);
      setTimeout(() => clearInterval(t), 15000);
    }
  }, []);

  // Leave room gracefully
  const leaveRoom = useCallback(() => {
    const gs = useGroupStore.getState();
    const myId = usePeerStore.getState().myId;
    const payload = JSON.stringify({
      type: "leave-room",
      peerId: myId,
    } as GroupDataMessage);
    gs.participants.forEach((p) => {
      if (p.dataConnection?.open) {
        try {
          p.dataConnection.send(payload);
        } catch {
          /* ignore */
        }
      }
    });
    groupStore.resetGroup();
    console.log("[GroupPeer] Left room");
  }, [groupStore]);

  // Broadcast a chat message to all connected participants
  const sendGroupMessage = useCallback((text: string) => {
    const gs = useGroupStore.getState();
    if (!text.trim()) return;
    const payload = JSON.stringify({
      type: "chat",
      text: text.trim(),
      displayName: gs.myDisplayName,
    } as GroupDataMessage);

    let sent = 0;
    gs.participants.forEach((p) => {
      if (p.dataConnection?.open) {
        try {
          p.dataConnection.send(payload);
          sent++;
        } catch {
          /* ignore */
        }
      }
    });
    console.log(`[GroupPeer] Chat broadcast to ${sent} peer(s)`);

    gs.addGroupMessage({
      id: crypto.randomUUID(),
      from: "me",
      displayName: gs.myDisplayName,
      text: text.trim(),
      timestamp: new Date(),
    });
  }, []);

  return { createRoom, joinRoom, invitePeer, leaveRoom, sendGroupMessage };
}
