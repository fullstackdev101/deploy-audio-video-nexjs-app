# Issue Analysis: Video Call Intermittently Missing

## Problem Summary

- **Symptom**: Sometimes video calls work properly; other times they only show text chat without any video stream
- **Frequency**: Intermittent/unreliable
- **Chat**: Always works correctly (not affected)

---

## Root Cause Identified

### Primary Issue: Audio-Only Fallback Not Properly Handled

The `getBestStream()` function in [PeerContainer.tsx](src/components/PeerContainer.tsx#L41-L68) implements a graceful degradation pattern:

```javascript
// 1. Attempt both video and audio together
// 2. Fallback to video-only
// 3. Fallback to audio-only
```

**Problem**: When either peer falls back to audio-only (due to missing camera, permission denied, or camera in-use), the system sets `status="connected"` and displays the full-screen video interface. However, the `remoteStream` exists but contains **ZERO video tracks**.

### Why This Happens

1. User A initiates call → gets audio-only stream (no camera)
2. User B answers → gets video stream (has camera)
3. Both sides: `remoteStream` is populated ✓
4. Both sides: `status = "connected"` ✓
5. **BUT**: User A's remote stream has no video tracks → blank black screen
6. User sees full-screen overlay but no video → appears "broken"

### Secondary Issues

#### 1. **No UI Feedback for Audio-Only Streams**

- [VideoInterface.tsx](src/components/VideoInterface.tsx#L74-L85) shows "Waiting for remote video…" only when `!remoteStream`
- When `remoteStream` has NO VIDEO TRACKS, the UI shows an empty black video element with no explanation

#### 2. **ActiveCallWrapper Doesn't Check for Video Tracks**

- [ActiveCallWrapper.tsx](src/components/ActiveCallWrapper.tsx#L19-L21) shows fullscreen overlay if any media exists:
  ```javascript
  const hasActiveMedia = !!(localStream || remoteStream);
  const isMediaCallActive =
    hasActiveMedia && (status === "calling" || status === "connected");
  ```
- Should check if video tracks specifically exist, not just stream presence

#### 3. **Media Call State Not Fully Tracked**

- In [PeerContainer.tsx](src/components/PeerContainer.tsx#L297-L340), when the receiver accepts a call with `acceptCall()`, there's no error handling if the media negotiation fails silently
- No fallback if ICE candidates are never exchanged

#### 4. **Potential Race Condition in Data Connection for Receiver**

- Data connection handling relies on the caller's outbound connection reaching the receiver's "connection" event
- If the peer connection has ICE issues, data connection may fail silently while media call appears "connected"

---

## Impact Assessment

| Scenario                                     | Outcome                                                      |
| -------------------------------------------- | ------------------------------------------------------------ |
| Both have cameras                            | ✓ Works perfectly                                            |
| Caller: camera only, Receiver: camera        | ✓ Works (caller shows their own PiP)                         |
| Caller: no camera, Receiver: camera          | ❌ **BROKEN**: Shows black screen, "connected" status        |
| Both: no cameras                             | ✓ Chat works, video overlay appropriately shows wait message |
| Camera in-use / permission denied (one side) | ❌ **BROKEN**: Same as above                                 |

---

## Recommended Fixes

### Fix 1: Detect Video Tracks and Show Appropriate UI (**PRIORITY 1**)

- Check `remoteStream?.getVideoTracks().length > 0` before showing video element
- Show audio-only indicator UI when no video tracks exist
- Only enable fullscreen video overlay if actual video tracks are present

### Fix 2: Add Media Constraint Feedback (**PRIORITY 1**)

- Display which constraints failed (e.g., "Camera unavailable, audio-only call")
- Show this in the connection UI and video interface

### Fix 3: Improved Error Detection (**PRIORITY 2**)

- Add ICE connection state monitoring
- Detect when media negotiation succeeds but stream arrives empty
- Provide user-friendly error messages

### Fix 4: Fallback UI for Audio-Only Calls (**PRIORITY 2**)

- Show avatar/name instead of empty video when no video tracks
- Allow users to toggle between "voice call" and "video call" modes
- Display call type indicator

---

## Files Affected

- `src/components/VideoInterface.tsx` - Needs video track detection
- `src/components/ActiveCallWrapper.tsx` - Needs video track check
- `src/components/PeerContainer.tsx` - Needs ICE state monitoring
- `src/store/usePeerStore.ts` - May need stream metadata tracking
